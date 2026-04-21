package com.podcraft.android.util

import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.UnknownHostException

/** Map common network exceptions to user-friendly messages. */
fun friendlyErrorMessage(e: Exception): String = when (e) {
    is UnknownHostException -> "Cannot reach the server. Check your internet connection."
    is ConnectException -> "Connection refused. Is the server running?"
    is SocketTimeoutException -> "Request timed out. Try again later."
    else -> e.message ?: "An unexpected error occurred."
}
