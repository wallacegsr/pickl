package com.wallacegsr.pickl

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.SSLHandshakeException

/**
 * Checks that an address is actually a Pickl server before we commit to it.
 *
 * Without this the failure mode is a blank WebView: the user typed something
 * slightly wrong, the page 404s or shows their NAS login, and there is nothing
 * to explain why. /api/health exists on the server purely so this screen can
 * tell three different problems apart and say which one happened.
 */
object ServerProbe {

    sealed interface Result {
        /** Reachable, and it really is Pickl. */
        data class Ok(val version: String) : Result

        /** Something answered, but it is not this app. */
        data object NotPickl : Result

        data class Unreachable(val reason: String) : Result
    }

    suspend fun check(origin: String): Result = withContext(Dispatchers.IO) {
        var connection: HttpURLConnection? = null
        try {
            connection = (URL("$origin/api/health").openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 10_000
                readTimeout = 10_000
                // A reverse proxy in front of the app may answer differently
                // for an unknown client; identify ourselves honestly.
                setRequestProperty("Accept", "application/json")
                setRequestProperty("User-Agent", USER_AGENT)
                instanceFollowRedirects = true
            }

            if (connection.responseCode !in 200..299) return@withContext Result.NotPickl

            val body = connection.inputStream.bufferedReader().use { it.readText() }
            val json = try {
                JSONObject(body)
            } catch (_: Exception) {
                // An HTML login page, a router admin panel, a different
                // container on the same hostname.
                return@withContext Result.NotPickl
            }

            if (json.optString("app") != "pickl") return@withContext Result.NotPickl

            Result.Ok(json.optString("version", "unknown"))
        } catch (_: SSLHandshakeException) {
            // Overwhelmingly a self-signed or expired certificate. Say so
            // plainly -- the app will not offer to skip the check.
            Result.Unreachable(
                "Could not verify the server's HTTPS certificate. If you use a " +
                    "self-signed certificate, install a trusted one (Let's Encrypt) first."
            )
        } catch (e: Exception) {
            Result.Unreachable(e.message ?: "Could not reach that address.")
        } finally {
            connection?.disconnect()
        }
    }

    /** Also appended to the WebView's UA, so the server sees one consistent name. */
    const val USER_AGENT_SUFFIX = "PicklAndroid/1.0"
    private const val USER_AGENT = USER_AGENT_SUFFIX
}
