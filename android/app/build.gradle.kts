plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

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
        versionCode = 1
        versionName = "1.0.0"
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
        }
        debug {
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
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
