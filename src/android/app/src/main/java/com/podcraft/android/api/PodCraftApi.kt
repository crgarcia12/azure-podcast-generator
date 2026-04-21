package com.podcraft.android.api

import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*

interface PodCraftApi {
    // Auth
    @POST("/api/auth/login")
    suspend fun login(@Body request: LoginRequest): Response<LoginResponse>

    @POST("/api/auth/register")
    suspend fun register(@Body request: RegisterRequest): Response<LoginResponse>

    @GET("/api/auth/registration-status")
    suspend fun getRegistrationStatus(): Response<RegistrationStatusResponse>

    @GET("/api/auth/me")
    suspend fun getMe(): Response<AuthUser>

    @POST("/api/auth/logout")
    suspend fun logout(): Response<ResponseBody>

    // Classic podcasts
    @GET("/api/podcasts")
    suspend fun listPodcasts(): Response<PodcastListResponse>

    @POST("/api/podcasts")
    suspend fun createPodcast(@Body request: CreatePodcastRequest): Response<PodcastResponse>

    @Streaming
    @GET("/api/podcasts/{episodeId}/audio")
    suspend fun getPodcastAudio(@Path("episodeId") episodeId: String): Response<ResponseBody>

    // Interactive sessions
    @GET("/api/podcasts/sessions")
    suspend fun listSessions(): Response<SessionListResponse>

    @POST("/api/podcasts/sessions")
    suspend fun createSession(@Body request: CreateSessionRequest): Response<SessionResponse>

    @GET("/api/podcasts/sessions/{sessionId}")
    suspend fun getSession(@Path("sessionId") sessionId: String): Response<SessionResponse>

    @DELETE("/api/podcasts/sessions/{sessionId}")
    suspend fun deleteSession(@Path("sessionId") sessionId: String): Response<ResponseBody>

    @GET("/api/podcasts/sessions/{sessionId}/segments/{segmentId}/audio")
    @Streaming
    suspend fun getSegmentAudio(
        @Path("sessionId") sessionId: String,
        @Path("segmentId") segmentId: String,
    ): Response<ResponseBody>

    // Admin
    @GET("/api/admin/users")
    suspend fun getAdminUsers(): Response<List<AdminUser>>
}
