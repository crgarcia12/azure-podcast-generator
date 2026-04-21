package com.podcraft.android.playback

import android.app.PendingIntent
import android.content.Intent
import android.os.Bundle
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.podcraft.android.api.ApiClient
import com.podcraft.android.api.Session
import com.podcraft.android.api.SessionSummary
import com.podcraft.android.ui.MainActivity
import kotlinx.coroutines.*

@OptIn(UnstableApi::class)
class PlaybackService : MediaLibraryService() {

    private var mediaSession: MediaLibrarySession? = null
    private lateinit var player: ExoPlayer
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Cached session data for browse tree
    private var cachedSessions: List<SessionSummary> = emptyList()
    private var cachedSessionDetail: Session? = null

    companion object {
        const val ROOT_ID = "root"
        const val SESSIONS_ID = "sessions"
    }

    override fun onCreate() {
        super.onCreate()

        player = ExoPlayer.Builder(this)
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                    .setUsage(C.USAGE_MEDIA)
                    .build(),
                /* handleAudioFocus= */ true,
            )
            .setHandleAudioBecomingNoisy(true)
            .build()

        player.addListener(object : Player.Listener {
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                // Update session state when segment changes
            }
        })

        val sessionActivityIntent = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        mediaSession = MediaLibrarySession.Builder(this, player, LibrarySessionCallback())
            .setSessionActivity(sessionActivityIntent)
            .build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? {
        return mediaSession
    }

    override fun onDestroy() {
        mediaSession?.run {
            player.release()
            release()
            mediaSession = null
        }
        scope.cancel()
        super.onDestroy()
    }

    fun loadAndPlaySession(sessionId: String) {
        scope.launch {
            try {
                val response = ApiClient.get().getSession(sessionId)
                if (!response.isSuccessful) return@launch

                val session = response.body()?.session ?: return@launch
                cachedSessionDetail = session

                val mediaItems = session.segments.map { segment ->
                    val audioUrl = "${ApiClient.getBaseUrl()}${segment.audioUrl}"
                    MediaItem.Builder()
                        .setMediaId(segment.id)
                        .setUri(audioUrl)
                        .setMediaMetadata(
                            MediaMetadata.Builder()
                                .setTitle("Segment ${segment.index + 1} of ${session.segments.size}")
                                .setSubtitle(session.topic)
                                .setArtist("PodCraft")
                                .setAlbumTitle(session.title)
                                .setIsPlayable(true)
                                .build()
                        )
                        .build()
                }

                withContext(Dispatchers.Main) {
                    player.setMediaItems(mediaItems)
                    player.prepare()
                    player.play()
                }
            } catch (e: Exception) {
                // Log error, could notify UI
            }
        }
    }

    private inner class LibrarySessionCallback : MediaLibrarySession.Callback {

        override fun onGetLibraryRoot(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<MediaItem>> {
            val root = MediaItem.Builder()
                .setMediaId(ROOT_ID)
                .setMediaMetadata(
                    MediaMetadata.Builder()
                        .setIsBrowsable(true)
                        .setIsPlayable(false)
                        .setTitle("PodCraft")
                        .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
                        .build()
                )
                .build()
            return Futures.immediateFuture(LibraryResult.ofItem(root, params))
        }

        override fun onGetChildren(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            return when (parentId) {
                ROOT_ID -> {
                    if (!ApiClient.isLoggedIn()) {
                        val signInItem = MediaItem.Builder()
                            .setMediaId("sign_in_prompt")
                            .setMediaMetadata(
                                MediaMetadata.Builder()
                                    .setTitle("Sign in on your phone")
                                    .setSubtitle("Open the PodCraft app to log in")
                                    .setIsPlayable(false)
                                    .setIsBrowsable(false)
                                    .build()
                            )
                            .build()
                        return Futures.immediateFuture(
                            LibraryResult.ofItemList(ImmutableList.of(signInItem), params)
                        )
                    }
                    fetchSessionsAsBrowseItems(params)
                }
                else -> Futures.immediateFuture(
                    LibraryResult.ofItemList(ImmutableList.of(), params)
                )
            }
        }

        override fun onGetItem(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String,
        ): ListenableFuture<LibraryResult<MediaItem>> {
            return Futures.immediateFuture(LibraryResult.ofError(LibraryResult.RESULT_ERROR_NOT_SUPPORTED))
        }

        override fun onSetMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
            startIndex: Int,
            startPositionMs: Long,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            // When Auto taps a session, load its segments
            if (mediaItems.size == 1) {
                val sessionId = mediaItems[0].mediaId
                if (sessionId.startsWith("session:")) {
                    loadAndPlaySession(sessionId.removePrefix("session:"))
                }
            }
            return super.onSetMediaItems(mediaSession, controller, mediaItems, startIndex, startPositionMs)
        }
    }

    private fun fetchSessionsAsBrowseItems(
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
        val future = com.google.common.util.concurrent.SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()

        scope.launch {
            try {
                val response = ApiClient.get().listSessions()
                if (!response.isSuccessful) {
                    future.set(LibraryResult.ofItemList(ImmutableList.of(), params))
                    return@launch
                }

                val sessions = response.body()?.sessions ?: emptyList()
                cachedSessions = sessions

                if (sessions.isEmpty()) {
                    val emptyItem = MediaItem.Builder()
                        .setMediaId("no_sessions")
                        .setMediaMetadata(
                            MediaMetadata.Builder()
                                .setTitle("No sessions yet")
                                .setSubtitle("Create a podcast on the web")
                                .setIsPlayable(false)
                                .setIsBrowsable(false)
                                .build()
                        )
                        .build()
                    future.set(LibraryResult.ofItemList(ImmutableList.of(emptyItem), params))
                    return@launch
                }

                val items = sessions.map { s ->
                    MediaItem.Builder()
                        .setMediaId("session:${s.id}")
                        .setMediaMetadata(
                            MediaMetadata.Builder()
                                .setTitle(s.title)
                                .setSubtitle("${s.topic} · ${s.segmentCount} segments")
                                .setIsPlayable(true)
                                .setIsBrowsable(false)
                                .setMediaType(MediaMetadata.MEDIA_TYPE_PODCAST_EPISODE)
                                .build()
                        )
                        .build()
                }
                future.set(LibraryResult.ofItemList(ImmutableList.copyOf(items), params))
            } catch (e: Exception) {
                future.set(LibraryResult.ofItemList(ImmutableList.of(), params))
            }
        }

        return future
    }
}
