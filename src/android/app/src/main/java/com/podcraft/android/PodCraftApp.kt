package com.podcraft.android

import android.app.Application
import com.podcraft.android.api.ApiClient

class PodCraftApp : Application() {
    override fun onCreate() {
        super.onCreate()
        ApiClient.init(this)
    }
}
