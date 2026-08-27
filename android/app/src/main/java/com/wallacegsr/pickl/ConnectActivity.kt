package com.wallacegsr.pickl

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.wallacegsr.pickl.databinding.ActivityConnectBinding
import kotlinx.coroutines.launch

/**
 * First-run (and "change server") screen.
 *
 * Launcher activity, but it gets out of the way immediately once a server is
 * stored -- a returning user should never see this.
 */
class ConnectActivity : AppCompatActivity() {

    private lateinit var binding: ActivityConnectBinding

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // `true` when arriving from the overflow menu, where the user wants to
        // change servers and must not be bounced straight back into the one
        // already saved.
        val changing = intent.getBooleanExtra(EXTRA_CHANGE_SERVER, false)

        val existing = ServerStore.saved(this)
        if (existing != null && !changing) {
            openMain(existing)
            return
        }

        binding = ActivityConnectBinding.inflate(layoutInflater)
        setContentView(binding.root)

        if (changing && existing != null) {
            binding.serverInput.setText(existing)
        }

        binding.connectButton.setOnClickListener { attemptConnect() }
        binding.serverInput.setOnEditorActionListener { _, _, _ ->
            attemptConnect()
            true
        }

        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    // Backing out of "change server" should leave the saved one
                    // alone rather than stranding the user on this screen.
                    if (changing && existing != null) openMain(existing) else finish()
                }
            }
        )
    }

    private fun attemptConnect() {
        val normalized = ServerStore.normalize(binding.serverInput.text?.toString().orEmpty())
        if (normalized is ServerStore.Normalized.Invalid) {
            showError(normalized.reason)
            return
        }
        val origin = (normalized as ServerStore.Normalized.Ok).url

        setBusy(true)
        lifecycleScope.launch {
            when (val result = ServerProbe.check(origin)) {
                is ServerProbe.Result.Ok -> {
                    ServerStore.save(this@ConnectActivity, origin)
                    openMain(origin)
                }
                ServerProbe.Result.NotPickl -> {
                    setBusy(false)
                    showError(
                        "That address answered, but it is not a Pickl server. " +
                            "Check the host name and port."
                    )
                }
                is ServerProbe.Result.Unreachable -> {
                    setBusy(false)
                    showError(result.reason)
                }
            }
        }
    }

    private fun setBusy(busy: Boolean) {
        binding.progress.visibility = if (busy) View.VISIBLE else View.GONE
        binding.connectButton.isEnabled = !busy
        binding.serverInput.isEnabled = !busy
    }

    private fun showError(message: String) {
        binding.errorText.text = message
        binding.errorText.visibility = View.VISIBLE
    }

    private fun openMain(origin: String) {
        startActivity(
            Intent(this, MainActivity::class.java)
                .putExtra(MainActivity.EXTRA_ORIGIN, origin)
        )
        finish()
    }

    companion object {
        const val EXTRA_CHANGE_SERVER = "change_server"
    }
}
