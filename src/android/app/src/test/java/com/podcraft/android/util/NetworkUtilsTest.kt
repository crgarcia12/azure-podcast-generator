package com.podcraft.android.util

import org.junit.Test
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class NetworkUtilsTest {

    @Test
    fun `UnknownHostException gives internet check message`() {
        val msg = friendlyErrorMessage(UnknownHostException("api.example.com"))
        assertTrue(msg.contains("internet", ignoreCase = true))
    }

    @Test
    fun `ConnectException gives server not running message`() {
        val msg = friendlyErrorMessage(ConnectException("Connection refused"))
        assertTrue(msg.contains("server", ignoreCase = true))
    }

    @Test
    fun `SocketTimeoutException gives timeout message`() {
        val msg = friendlyErrorMessage(SocketTimeoutException("Read timed out"))
        assertTrue(msg.contains("timed out", ignoreCase = true))
    }

    @Test
    fun `generic exception uses its message`() {
        val msg = friendlyErrorMessage(RuntimeException("Custom error"))
        assertEquals("Custom error", msg)
    }

    @Test
    fun `exception without message gives fallback`() {
        val msg = friendlyErrorMessage(RuntimeException())
        assertTrue(msg.contains("unexpected", ignoreCase = true))
    }
}
