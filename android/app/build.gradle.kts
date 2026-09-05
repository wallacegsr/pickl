plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * Short commit the APK was built from, appended to the version name so
 * "which build is this?" is answerable from Android's app info instead of by
 * inference. Sideloaded builds have no store listing and no update channel, so
 * without it a stale install and a current one look identical.
 *
 * Falls back through: an explicit -PbuildSha, CI's GITHUB_SHA, the local git
 * checkout, then "local" when none of those exist (a source drop with no .git,
 * for instance) -- a missing SHA must never fail the build.
 */
val buildSha: String =
    (project.findProperty("buildSha") as String?)?.take(7)
        ?: System.getenv("GITHUB_SHA")?.take(7)
        ?: runCatching {
            val process = ProcessBuilder("git", "rev-parse", "--short=7", "HEAD")
                .directory(rootProject.projectDir)
                .redirectErrorStream(true)
                .start()
            val text = process.inputStream.bufferedReader().use { it.readText() }.trim()
            if (process.waitFor() == 0 && text.isNotEmpty()) text else null
        }.getOrNull()
        ?: "local"

android {
    namespace = "com.wallacegsr.pickl"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.wallacegsr.pickl"
        // 26 = Android 8.0. Two reasons, both practical rather than arbitrary:
        // the launcher icon is an adaptive icon (mipmap-anydpi-v26), which
        // would simply be missing below this, and older system WebViews
        // predate cookie and TLS behaviour this app relies on. 8.0 covers
        // effectively every device still receiving updates.
        minSdk = 26
        targetSdk = 34
        // versionCode is the number Android actually compares when deciding
        // whether an APK is an upgrade; versionName is only ever shown to
        // people. It must increase on every build that ships, so it is bumped
        // alongside the name rather than tracking it — the two are different
        // kinds of number and only one of them gates installation.
        versionCode = 2
        // Kept in lockstep with package.json and the CHANGELOG.md heading.
        versionName = "1.1.0"
    }

    signingConfigs {
        create("release") {
            // Supplied by CI (or a local keystore.properties) -- never committed.
            val storePath = System.getenv("PICKL_KEYSTORE_PATH")
            if (storePath != null) {
                storeFile = file(storePath)
                storePassword = System.getenv("PICKL_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("PICKL_KEY_ALIAS")
                keyPassword = System.getenv("PICKL_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Falls back to an unsigned build when no keystore is configured,
            // so a plain `assembleRelease` still succeeds locally.
            if (System.getenv("PICKL_KEYSTORE_PATH") != null) {
                signingConfig = signingConfigs.getByName("release")
            }
            versionNameSuffix = "-$buildSha"
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug-$buildSha"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.2")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
