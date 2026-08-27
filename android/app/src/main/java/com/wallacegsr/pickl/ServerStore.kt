package com.wallacegsr.pickl

import android.content.Context
import android.net.Uri

/**
 * The one piece of state this app owns: which server to talk to.
 *
 * Everything else -- session, theme, plans -- lives on that server or in the
 * WebView's own storage, which is why this file is so small.
 */
object ServerStore {

    private const val PREFS = "pickl_server"
    private const val KEY_URL = "server_url"

    fun saved(context: Context): String? =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_URL, null)

    fun save(context: Context, url: String) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_URL, url)
            .apply()
    }

    fun clear(context: Context) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_URL)
            .apply()
    }

    /** Outcome of tidying up whatever the user typed into the address box. */
    sealed interface Normalized {
        data class Ok(val url: String) : Normalized
        data class Invalid(val reason: String) : Normalized
    }

    /**
     * Turns human input ("pickl.example.com", "https://pickl.example.com/plan/")
     * into a bare origin we can safely build URLs from.
     *
     * Bare hosts get https:// rather than http://. Plain http is rejected
     * outright instead of being silently upgraded, because a user who
     * deliberately typed http:// deserves to be told why it will not work
     * rather than to wonder why the app ignored them. The session cookie is a
     * bearer credential; sending it over cleartext on whatever coffee-shop
     * wifi the phone has joined is not a trade worth offering as a checkbox.
     */
    fun normalize(input: String): Normalized {
        val trimmed = input.trim()
        if (trimmed.isEmpty()) return Normalized.Invalid("Enter your Pickl server address.")

        val withScheme =
            if (trimmed.contains("://")) trimmed else "https://$trimmed"

        val uri = try {
            Uri.parse(withScheme)
        } catch (_: Exception) {
            return Normalized.Invalid("That does not look like a web address.")
        }

        val scheme = uri.scheme?.lowercase()
        if (scheme == "http") {
            return Normalized.Invalid(
                "Plain http is not supported. Use https so your login cannot be " +
                    "read off the network."
            )
        }
        if (scheme != "https") {
            return Normalized.Invalid("Use an https:// address.")
        }

        val host = uri.host
        if (host.isNullOrBlank()) {
            return Normalized.Invalid("That address is missing a host name.")
        }

        // Keep an explicit port, drop path/query/fragment: pasting a deep link
        // to /plan should still register the server itself.
        val port = if (uri.port != -1) ":${uri.port}" else ""
        return Normalized.Ok("https://$host$port")
    }
}
