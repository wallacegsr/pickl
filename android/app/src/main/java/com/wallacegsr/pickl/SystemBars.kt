package com.wallacegsr.pickl

import android.view.View
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

/**
 * Keeps [root]'s content clear of the status bar, navigation bar, display
 * cutout and on-screen keyboard.
 *
 * From targetSdk 35 Android draws every app edge to edge whether it asks to or
 * not: the window runs under the system bars, `statusBarColor` is ignored, and
 * `adjustResize` no longer shrinks the window for the keyboard. Without this
 * the web app's header sits under the clock and the keyboard covers whatever
 * field is being typed in. Padding the root by the insets restores both, and
 * the padding shows the root's own background, which is what now colours the
 * bars.
 */
internal fun padForSystemBars(root: View) {
    ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
        val bars = insets.getInsets(
            WindowInsetsCompat.Type.systemBars() or
                WindowInsetsCompat.Type.displayCutout() or
                WindowInsetsCompat.Type.ime()
        )
        view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
        WindowInsetsCompat.CONSUMED
    }
}
