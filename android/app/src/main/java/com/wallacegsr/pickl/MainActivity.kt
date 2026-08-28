package com.wallacegsr.pickl

import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.view.View
import android.webkit.CookieManager
import android.webkit.URLUtil
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.wallacegsr.pickl.databinding.ActivityMainBinding

/**
 * The app proper: a WebView pointed at the user's own server.
 *
 * Deliberately thin. Because the WebView's origin *is* the server's origin,
 * the existing cookie session works untouched -- no token rework, no API
 * shim, no second copy of the UI to keep in step. What this class does is
 * cover the handful of things a bare WebView gets wrong.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var origin: String
    private var lastLoadFailed = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        origin = intent.getStringExtra(EXTRA_ORIGIN)
            ?: ServerStore.saved(this)
            // Storage cleared behind our back; start over rather than crash.
            ?: run {
                startActivity(Intent(this, ConnectActivity::class.java))
                finish()
                return
            }

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        configureWebView()
        configureBackNavigation()

        binding.swipeRefresh.setOnRefreshListener { binding.webView.reload() }
        binding.retryButton.setOnClickListener { retry() }
        // The only way back to the connect screen when the page will not load.
        // Without it, a wrong address or a server that has moved leaves the app
        // permanently stuck on the error panel with no way to correct it --
        // the web menu that normally offers this cannot render.
        binding.changeServerButton.setOnClickListener { confirmChangeServer() }

        if (savedInstanceState == null) {
            binding.webView.loadUrl(origin)
        } else {
            binding.webView.restoreState(savedInstanceState)
        }
    }

    private fun configureWebView() = with(binding.webView.settings) {
        javaScriptEnabled = true

        // Pickl keeps the theme preference, the sidebar collapse state and the
        // meal-plan column widths in localStorage, and reads them in a
        // pre-hydration inline script. This is off by default in a WebView;
        // leaving it off makes dark mode silently fail to persist.
        domStorageEnabled = true

        loadsImagesAutomatically = true
        mediaPlaybackRequiresUserGesture = true

        // No file:// or content:// access: nothing in this app needs to read
        // local files, and a WebView that can is a much larger target.
        allowFileAccess = false
        allowContentAccess = false

        // Let the server recognise the shell if it ever wants to adapt.
        userAgentString = "$userAgentString ${ServerProbe.USER_AGENT_SUFFIX}"

        cacheMode = WebSettings.LOAD_DEFAULT

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(binding.webView, true)
        }

        binding.webView.webViewClient = PicklWebViewClient()
        binding.webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            startDownload(url, userAgent, contentDisposition, mimeType)
        }

        // Lets the web app's own account menu offer Reload and Change server,
        // so the app has one menu instead of a native toolbar stacked above the
        // page's own header.
        //
        // Only @JavascriptInterface-annotated methods are reachable (true since
        // API 17; this app requires 26). The surface is deliberately two no-arg
        // methods: an injected object is visible to every frame, including any
        // iframe, so the worst a hostile one could do is reload the page or
        // raise a dialog the user can cancel. Nothing here acts without either
        // being harmless or asking first.
        binding.webView.addJavascriptInterface(PicklBridge(), "PicklShell")
    }

    /** @see com.wallacegsr.pickl web app `src/lib/shell.ts` for the contract. */
    private inner class PicklBridge {

        // Both of these arrive on a background thread -- WebView calls
        // JavascriptInterface methods off the UI thread -- so every line that
        // touches a View or shows a dialog has to be posted back.

        @android.webkit.JavascriptInterface
        fun reload() {
            runOnUiThread { binding.webView.reload() }
        }

        @android.webkit.JavascriptInterface
        fun changeServer() {
            runOnUiThread { confirmChangeServer() }
        }
    }

    /**
     * Hands a download to Android's DownloadManager.
     *
     * The cookie forwarding is the part that is easy to miss: DownloadManager
     * runs in a different process with its own (empty) cookie jar, so without
     * this every export -- the meal plan JSON and iCal, the shopping list --
     * would follow the server's redirect to /login and silently save the login
     * page instead of the file.
     */
    private fun startDownload(
        url: String,
        userAgent: String?,
        contentDisposition: String?,
        mimeType: String?
    ) {
        // Only ever download from the configured server. A page cannot use us
        // as a general-purpose fetcher for somewhere else.
        if (!isSameOrigin(url)) {
            openExternally(url)
            return
        }

        try {
            val filename = URLUtil.guessFileName(url, contentDisposition, mimeType)
            val request = DownloadManager.Request(Uri.parse(url)).apply {
                CookieManager.getInstance().getCookie(url)?.let {
                    addRequestHeader("Cookie", it)
                }
                userAgent?.let { addRequestHeader("User-Agent", it) }
                setMimeType(mimeType)
                setTitle(filename)
                setDescription(getString(R.string.download_from_pickl))
                setNotificationVisibility(
                    DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                )
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
            }
            (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
            showSnack(getString(R.string.download_started, filename))
        } catch (_: Exception) {
            showSnack(getString(R.string.download_failed))
        }
    }

    private inner class PicklWebViewClient : WebViewClient() {

        /*
         * Note what is NOT overridden here: onReceivedSslError.
         *
         * Overriding it to call proceed() is the standard cure-all found in
         * WebView tutorials, and it silently disables certificate validation
         * for every request the app makes -- turning a self-hosted app that
         * carries a session cookie into something trivially interceptable. If
         * the certificate does not validate, the right fix is on the server
         * (Let's Encrypt via the DSM reverse proxy), not here.
         */

        override fun shouldOverrideUrlLoading(
            view: WebView,
            request: WebResourceRequest
        ): Boolean {
            val url = request.url.toString()

            // Keep the app on the user's server; everything else -- a recipe's
            // source link, a mailto:, a tel: -- belongs to the system, so the
            // user is never trapped in a page with no way back.
            if (isSameOrigin(url)) return false

            openExternally(url)
            return true
        }

        override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
            lastLoadFailed = false
        }

        override fun onPageFinished(view: WebView?, url: String?) {
            binding.swipeRefresh.isRefreshing = false
            // Persist the session cookie now rather than at process death,
            // which is not guaranteed to run.
            CookieManager.getInstance().flush()

            if (!lastLoadFailed) {
                binding.errorPanel.visibility = View.GONE
                binding.swipeRefresh.visibility = View.VISIBLE
            }
        }

        override fun onReceivedError(
            view: WebView,
            request: WebResourceRequest,
            error: WebResourceError
        ) {
            // Subresource failures (a missing icon) must not blank the app.
            if (!request.isForMainFrame) return

            lastLoadFailed = true
            binding.swipeRefresh.isRefreshing = false
            binding.errorText.text = getString(R.string.error_unreachable, origin)
            binding.errorPanel.visibility = View.VISIBLE
            binding.swipeRefresh.visibility = View.GONE
        }
    }

    private fun isSameOrigin(url: String): Boolean = try {
        val candidate = Uri.parse(url)
        val base = Uri.parse(origin)
        candidate.scheme?.lowercase() == base.scheme?.lowercase() &&
            candidate.host?.lowercase() == base.host?.lowercase() &&
            candidate.port == base.port
    } catch (_: Exception) {
        false
    }

    private fun openExternally(url: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
        } catch (_: ActivityNotFoundException) {
            showSnack(getString(R.string.no_app_to_open_link))
        }
    }

    private fun configureBackNavigation() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    // Without this, back closes the app from anywhere in the
                    // site -- including a modal or a recipe page.
                    if (binding.webView.canGoBack()) {
                        binding.webView.goBack()
                    } else {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        )
    }

    private fun retry() {
        binding.errorPanel.visibility = View.GONE
        binding.swipeRefresh.visibility = View.VISIBLE
        binding.webView.loadUrl(origin)
    }

    private fun showSnack(message: String) {
        com.google.android.material.snackbar.Snackbar
            .make(binding.root, message, com.google.android.material.snackbar.Snackbar.LENGTH_LONG)
            .show()
    }

    private fun confirmChangeServer() {
        AlertDialog.Builder(this)
            .setTitle(R.string.change_server)
            .setMessage(R.string.change_server_message)
            .setPositiveButton(R.string.change_server_confirm) { _, _ ->
                // Drop the session with the old server too -- leaving a live
                // cookie for a host the user is walking away from is careless.
                CookieManager.getInstance().removeAllCookies(null)
                CookieManager.getInstance().flush()
                binding.webView.clearHistory()
                ServerStore.clear(this)
                startActivity(
                    Intent(this, ConnectActivity::class.java)
                        .putExtra(ConnectActivity.EXTRA_CHANGE_SERVER, true)
                )
                finish()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        binding.webView.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
    }

    companion object {
        const val EXTRA_ORIGIN = "origin"
    }
}
