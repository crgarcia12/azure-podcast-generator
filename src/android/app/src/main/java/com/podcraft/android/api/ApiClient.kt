package com.podcraft.android.api

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.podcraft.android.BuildConfig
import kotlinx.serialization.json.Json
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

object ApiClient {
    private lateinit var api: PodCraftApi
    private lateinit var cookieJar: PersistentCookieJar

    fun init(context: Context) {
        cookieJar = PersistentCookieJar(context)

        val logging = HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY
                    else HttpLoggingInterceptor.Level.NONE
        }

        val client = OkHttpClient.Builder()
            .cookieJar(cookieJar)
            .addInterceptor(logging)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(60, TimeUnit.SECONDS)
            .build()

        val json = Json { ignoreUnknownKeys = true }

        val retrofit = Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()

        api = retrofit.create(PodCraftApi::class.java)
    }

    fun get(): PodCraftApi = api

    fun getBaseUrl(): String = BuildConfig.API_BASE_URL

    fun isLoggedIn(): Boolean = cookieJar.hasCookies()

    fun clearAuth() {
        cookieJar.clear()
    }
}

class PersistentCookieJar(context: Context) : CookieJar {
    private val masterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        "podcraft_cookies",
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    private val cookies = mutableListOf<Cookie>()

    init {
        // Restore cookies from encrypted storage
        val stored = prefs.getString("cookies", null)
        if (stored != null) {
            stored.split("|").forEach { cookieStr ->
                Cookie.parse(HttpUrl.Builder().scheme("http").host("placeholder").build(), cookieStr)
                    ?.let { cookies.add(it) }
            }
        }
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        this.cookies.removeAll { existing ->
            cookies.any { it.name == existing.name }
        }
        this.cookies.addAll(cookies)
        persist()
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        cookies.removeAll { it.expiresAt < System.currentTimeMillis() }
        return cookies.toList()
    }

    fun hasCookies(): Boolean = cookies.isNotEmpty()

    fun clear() {
        cookies.clear()
        prefs.edit().clear().apply()
    }

    private fun persist() {
        val value = cookies.joinToString("|") { it.toString() }
        prefs.edit().putString("cookies", value).apply()
    }
}
