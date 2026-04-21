package com.podcraft.android.api

import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(val username: String, val password: String)

@Serializable
data class AuthUser(val username: String, val role: String, val createdAt: String)

@Serializable
data class SessionSummary(
    val id: String,
    val topic: String,
    val title: String,
    val segmentCount: Int,
    val interruptCount: Int,
    val status: String,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class Segment(
    val id: String,
    val index: Int,
    val hostLine: String,
    val guestLine: String,
    val status: String,
    val revision: Int,
    val audioUrl: String,
    val generatedAfterInterrupt: String? = null,
)

@Serializable
data class Interrupt(
    val id: String,
    val afterSegmentId: String,
    val questionText: String,
    val inputMethod: String,
    val createdAt: String,
)

@Serializable
data class Session(
    val id: String,
    val topic: String,
    val title: String,
    val summary: String,
    val revision: Int,
    val status: String,
    val segments: List<Segment>,
    val interrupts: List<Interrupt>,
    val createdAt: String,
    val updatedAt: String,
)

@Serializable
data class SessionListResponse(val sessions: List<SessionSummary>)

@Serializable
data class SessionResponse(val session: Session)

@Serializable
data class LoginResponse(val user: AuthUser)

@Serializable
data class ErrorResponse(val error: String)
