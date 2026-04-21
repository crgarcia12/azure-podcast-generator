package com.podcraft.android.api

import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

interface PodCraftApi {
    @POST("/api/auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @GET("/api/auth/me")
    suspend fun getMe(): Response<AuthUser>

    @POST("/api/auth/logout")
    suspend fun logout(): Response<ResponseBody>

    @GET("/api/podcasts/sessions")
    suspend fun listSessions(): Response<SessionListResponse>

    @GET("/api/podcasts/sessions/{sessionId}")
    suspend fun getSession(@Path("sessionId") sessionId: String): Response<SessionResponse>

    @GET("/api/podcasts/sessions/{sessionId}/segments/{segmentId}/audio")
    @Streaming
    suspend fun getSegmentAudio(
        @Path("sessionId") sessionId: String,
        @Path("segmentId") segmentId: String,
    ): Response<ResponseBody>
}
