# The app is a WebView shell with no reflection-based serialization, so the
# defaults are almost enough on their own.

# Keep the JavascriptInterface contract available in case a bridge is ever
# added; without this, R8 would strip annotated methods a page calls by name.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# org.json ships with the platform; nothing to keep or warn about.
-dontwarn org.json.**
