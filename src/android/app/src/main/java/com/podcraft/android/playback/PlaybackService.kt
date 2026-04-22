package com.podcraft.android.playback

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
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
import com.google.common.util.concurrent.SettableFuture
import com.podcraft.android.api.ApiClient
import com.podcraft.android.api.Session
import com.podcraft.android.api.SessionSummary
import com.podcraft.android.ui.MainActivity
import kotlinx.coroutines.*

private const val TAG = "PlaybackService"

@OptIn(UnstableApi::class)
class PlaybackService : MediaLibraryService() {

    private var mediaSession: MediaLibrarySession? = null
    private lateinit var player: ExoPlayer
    private val scope = CoroutineScope(Dispatchers.IO + SupervisorJob())

    // Media item caches for browse tree
    private val sessionCache = mutableMapOf<String, Session>()
    private val mediaItemCache = mutableMapOf<String, MediaItem>()
    private var cachedSessions: List<SessionSummary> = emptyList()
    private var lastPlayedSessionId: String? = null

    companion object {
        const val ROOT_ID = "root"
        const val RECENT_ID = "recent"
        const val FAVORITES_ID = "favorites"
        const val ALL_SESSIONS_ID = "all_sessions"

        private const val PREFS_NAME = "playback_state"
        private const val KEY_LAST_SESSION = "last_session_id"
        private const val KEY_LAST_SEGMENT_INDEX = "last_segment_index"
        private const val KEY_LAST_POSITION_MS = "last_position_ms"
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
                persistPlaybackState()
            }

            override fun onIsPlayingChanged(isPlaying: Boolean) {
                if (!isPlaying && player.mediaItemCount > 0) {
                    persistPlaybackState()
                }
            }
        })

        restoreLastSession()

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
        persistPlaybackState()
        mediaSession?.run {
            player.release()
            release()
            mediaSession = null
        }
        scope.cancel()
        super.onDestroy()
    }

    /**
     * Load a session's segments and play them as a queue.
     * Used by both in-app PlayerScreen and Android Auto.
     */
    fun loadAndPlaySession(sessionId: String, startIndex: Int = 0, startPositionMs: Long = 0L) {
        scope.launch {
            try {
                val response = ApiClient.get().getSession(sessionId)
                if (!response.isSuccessful) {
                    Log.e(TAG, "Failed to load session $sessionId: HTTP ${response.code()}")
                    return@launch
                }

                val session = response.body()?.session ?: run {
                    Log.e(TAG, "Empty response for session $sessionId")
                    return@launch
                }

                sessionCache[sessionId] = session
                lastPlayedSessionId = sessionId

                val mediaItems = buildSegmentMediaItems(session)
                cacheMediaItems(mediaItems)

                withContext(Dispatchers.Main) {
                    player.setMediaItems(mediaItems, startIndex, startPositionMs)
                    player.prepare()
                    player.play()
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error loading session $sessionId", e)
            }
        }
    }

    private fun buildSegmentMediaItems(session: Session): List<MediaItem> {
        return session.segments.map { segment ->
            val audioUrl = "${ApiClient.getBaseUrl()}${segment.audioUrl}"
            MediaItem.Builder()
                .setMediaId("segment:${session.id}:${segment.id}")
                .setUri(audioUrl)
                .setMediaMetadata(
                    MediaMetadata.Builder()
                        .setTitle("Segment ${segment.index + 1}: ${session.title}")
                        .setSubtitle(session.topic)
                        .setArtist("PodCraft")
                        .setAlbumTitle(session.title)
                        .setTrackNumber(segment.index + 1)
                        .setTotalTrackCount(session.segments.size)
                        .setIsPlayable(true)
                        .setIsBrowsable(false)
                        .setMediaType(MediaMetadata.MEDIA_TYPE_PODCAST_EPISODE)
                        .build()
                )
                .build()
        }
    }

    private fun cacheMediaItems(items: List<MediaItem>) {
        items.forEach { mediaItemCache[it.mediaId] = it }
    }

    private fun persistPlaybackState() {
        val sessionId = lastPlayedSessionId ?: return
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putString(KEY_LAST_SESSION, sessionId)
            .putInt(KEY_LAST_SEGMENT_INDEX, player.currentMediaItemIndex)
            .putLong(KEY_LAST_POSITION_MS, player.currentPosition)
            .apply()
    }

    private fun restoreLastSession() {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        lastPlayedSessionId = prefs.getString(KEY_LAST_SESSION, null)
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

            return when (parentId) {
                ROOT_ID -> buildRootChildren(params)
                RECENT_ID -> fetchSessionItems(params, filter = "recent")
                FAVORITES_ID -> fetchSessionItems(params, filter = "favorites")
                ALL_SESSIONS_ID -> fetchSessionItems(params, filter = "all")
                else -> {
                    // Session children: "Play all" + individual segments
                    if (parentId.startsWith("session:")) {
                        val sessionId = parentId.removePrefix("session:")
                        buildSessionChildren(sessionId, params)
                    } else {
                        Futures.immediateFuture(
                            LibraryResult.ofItemList(ImmutableList.of(), params)
                        )
                    }
                }
            }
        }

        override fun onGetItem(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String,
        ): ListenableFuture<LibraryResult<MediaItem>> {
            // Check cache first
            mediaItemCache[mediaId]?.let {
                return Futures.immediateFuture(LibraryResult.ofItem(it, null))
            }

            // Build well-known category items on demand
            val categoryItem = buildCategoryItem(mediaId)
            if (categoryItem != null) {
                return Futures.immediateFuture(LibraryResult.ofItem(categoryItem, null))
            }

            // For session items, try to find in cached sessions list
            if (mediaId.startsWith("session:")) {
                val sessionId = mediaId.removePrefix("session:")
                cachedSessions.find { it.id == sessionId }?.let { s ->
                    val item = buildSessionBrowseItem(s)
                    mediaItemCache[mediaId] = item
                    return Futures.immediateFuture(LibraryResult.ofItem(item, null))
                }
            }

            return Futures.immediateFuture(
                LibraryResult.ofError(LibraryResult.RESULT_ERROR_BAD_VALUE)
            )
        }

        override fun onSetMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
            startIndex: Int,
            startPositionMs: Long,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
            if (mediaItems.size == 1) {
                val mediaId = mediaItems[0].mediaId

                // "Play all" for a session
                if (mediaId.startsWith("play_all:") || mediaId.startsWith("session:")) {
                    val sessionId = mediaId
                        .removePrefix("play_all:")
                        .removePrefix("session:")
                    return resolveSessionQueue(sessionId, 0, 0L)
                }

                // Individual segment — play the whole session starting at that segment
                if (mediaId.startsWith("segment:")) {
                    val parts = mediaId.removePrefix("segment:").split(":", limit = 2)
                    if (parts.size == 2) {
                        val sessionId = parts[0]
                        val segmentId = parts[1]
                        val cachedSession = sessionCache[sessionId]
                        val segIndex = cachedSession?.segments
                            ?.indexOfFirst { it.id == segmentId }
                            ?.takeIf { it >= 0 } ?: 0
                        return resolveSessionQueue(sessionId, segIndex, 0L)
                    }
                }
            }

            return super.onSetMediaItems(mediaSession, controller, mediaItems, startIndex, startPositionMs)
        }

        override fun onSearch(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            query: String,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<Void>> {
            // Trigger async search, then notify children changed
            scope.launch {
                try {
                    val response = ApiClient.get().listSessions()
                    if (response.isSuccessful) {
                        val sessions = response.body()?.sessions ?: emptyList()
                        val matching = sessions.filter { s ->
                            s.title.contains(query, ignoreCase = true) ||
                                s.topic.contains(query, ignoreCase = true)
                        }
                        val items = matching.map { buildSessionBrowseItem(it) }
                        items.forEach { mediaItemCache[it.mediaId] = it }
                        withContext(Dispatchers.Main) {
                            session.notifySearchResultChanged(browser, query, items.size, params)
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Search failed", e)
                }
            }
            return Futures.immediateFuture(LibraryResult.ofVoid())
        }

        override fun onGetSearchResult(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            query: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
            val matching = cachedSessions.filter { s ->
                s.title.contains(query, ignoreCase = true) ||
                    s.topic.contains(query, ignoreCase = true)
            }
            val items = matching
                .drop(page * pageSize)
                .take(pageSize)
                .map { buildSessionBrowseItem(it) }
            return Futures.immediateFuture(
                LibraryResult.ofItemList(ImmutableList.copyOf(items), params)
            )
        }
    }

    // ─── Browse tree builders ────────────────────────────────────────────

    private fun buildRootChildren(
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
        val children = mutableListOf<MediaItem>()

        // "Continue listening" if there's a last-played session
        if (lastPlayedSessionId != null) {
            val resumeItem = MediaItem.Builder()
                .setMediaId("play_all:$lastPlayedSessionId")
                .setMediaMetadata(
                    MediaMetadata.Builder()
                        .setTitle("▶ Continue listening")
                        .setSubtitle("Resume where you left off")
                        .setIsPlayable(true)
                        .setIsBrowsable(false)
                        .setMediaType(MediaMetadata.MEDIA_TYPE_PLAYLIST)
                        .build()
                )
                .build()
            children.add(resumeItem)
            mediaItemCache[resumeItem.mediaId] = resumeItem
        }

        children.add(buildCategoryItem(FAVORITES_ID)!!)
        children.add(buildCategoryItem(RECENT_ID)!!)
        children.add(buildCategoryItem(ALL_SESSIONS_ID)!!)

        return Futures.immediateFuture(
            LibraryResult.ofItemList(ImmutableList.copyOf(children), params)
        )
    }

    private fun buildCategoryItem(mediaId: String): MediaItem? {
        val (title, subtitle) = when (mediaId) {
            FAVORITES_ID -> "⭐ Favorites" to "Your starred sessions"
            RECENT_ID -> "🕐 Recent" to "Recently created sessions"
            ALL_SESSIONS_ID -> "📚 All Sessions" to "Browse all your podcasts"
            else -> return null
        }
        val item = MediaItem.Builder()
            .setMediaId(mediaId)
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setIsBrowsable(true)
                    .setIsPlayable(false)
                    .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_PODCASTS)
                    .build()
            )
            .build()
        mediaItemCache[mediaId] = item
        return item
    }

    private fun fetchSessionItems(
        params: LibraryParams?,
        filter: String,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
        val future = SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()

        scope.launch {
            try {
                val response = ApiClient.get().listSessions()
                if (!response.isSuccessful) {
                    future.set(LibraryResult.ofItemList(ImmutableList.of(), params))
                    return@launch
                }

                val sessions = response.body()?.sessions ?: emptyList()
                cachedSessions = sessions

                val filtered = when (filter) {
                    "favorites" -> sessions.filter { it.favorite }
                    "recent" -> sessions.sortedByDescending { it.updatedAt }.take(10)
                    else -> sessions
                }

                if (filtered.isEmpty()) {
                    val emptyItem = MediaItem.Builder()
                        .setMediaId("empty_$filter")
                        .setMediaMetadata(
                            MediaMetadata.Builder()
                                .setTitle(if (filter == "favorites") "No favorites yet" else "No sessions yet")
                                .setSubtitle("Create a podcast in the app")
                                .setIsPlayable(false)
                                .setIsBrowsable(false)
                                .build()
                        )
                        .build()
                    future.set(LibraryResult.ofItemList(ImmutableList.of(emptyItem), params))
                    return@launch
                }

                val items = filtered.map { s ->
                    val item = buildSessionBrowseItem(s)
                    mediaItemCache[item.mediaId] = item
                    item
                }
                future.set(LibraryResult.ofItemList(ImmutableList.copyOf(items), params))
            } catch (e: Exception) {
                Log.e(TAG, "Failed to fetch sessions for $filter", e)
                future.set(LibraryResult.ofItemList(ImmutableList.of(), params))
            }
        }

        return future
    }

    private fun buildSessionBrowseItem(s: SessionSummary): MediaItem {
        return MediaItem.Builder()
            .setMediaId("session:${s.id}")
            .setMediaMetadata(
                MediaMetadata.Builder()
                    .setTitle(s.title)
                    .setSubtitle("${s.topic} · ${s.segmentCount} segments")
                    .setIsPlayable(false)
                    .setIsBrowsable(true)
                    .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_PODCASTS)
                    .build()
            )
            .build()
    }

    private fun buildSessionChildren(
        sessionId: String,
        params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> {
        val future = SettableFuture.create<LibraryResult<ImmutableList<MediaItem>>>()

        scope.launch {
            try {
                val session = sessionCache[sessionId] ?: run {
                    val response = ApiClient.get().getSession(sessionId)
                    if (!response.isSuccessful) {
                        future.set(LibraryResult.ofItemList(ImmutableList.of(), params))
                        return@launch
                    }
                    response.body()?.session?.also { sessionCache[sessionId] = it }
                }

                if (session == null) {
                    future.set(LibraryResult.ofItemList(ImmutableList.of(), params))
                    return@launch
                }

                val children = mutableListOf<MediaItem>()

                // "Play all" item
                val playAll = MediaItem.Builder()
                    .setMediaId("play_all:$sessionId")
                    .setMediaMetadata(
                        MediaMetadata.Builder()
                            .setTitle("▶ Play all (${session.segments.size} segments)")
                            .setSubtitle(session.topic)
                            .setIsPlayable(true)
                            .setIsBrowsable(false)
                            .setMediaType(MediaMetadata.MEDIA_TYPE_PLAYLIST)
                            .build()
                    )
                    .build()
                children.add(playAll)
                mediaItemCache[playAll.mediaId] = playAll

                // Individual segments
                val segmentItems = buildSegmentMediaItems(session)
                cacheMediaItems(segmentItems)
                children.addAll(segmentItems)

                future.set(LibraryResult.ofItemList(ImmutableList.copyOf(children), params))
            } catch (e: Exception) {
                Log.e(TAG, "Failed to build session children for $sessionId", e)
                future.set(LibraryResult.ofItemList(ImmutableList.of(), params))
            }
        }

        return future
    }

    /**
     * Resolve a session ID into a full queue of segment MediaItems.
     * Returns the resolved items with the given start index/position.
     */
    private fun resolveSessionQueue(
        sessionId: String,
        startIndex: Int,
        startPositionMs: Long,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
        val future = SettableFuture.create<MediaSession.MediaItemsWithStartPosition>()

        scope.launch {
            try {
                val session = sessionCache[sessionId] ?: run {
                    val response = ApiClient.get().getSession(sessionId)
                    response.body()?.session?.also { sessionCache[sessionId] = it }
                }

                if (session == null || session.segments.isEmpty()) {
                    future.set(
                        MediaSession.MediaItemsWithStartPosition(
                            emptyList(), startIndex, startPositionMs
                        )
                    )
                    return@launch
                }

                lastPlayedSessionId = sessionId
                val mediaItems = buildSegmentMediaItems(session)
                cacheMediaItems(mediaItems)

                // If resuming, check for saved position
                val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val savedSession = prefs.getString(KEY_LAST_SESSION, null)
                val resumeIndex = if (savedSession == sessionId && startIndex == 0) {
                    prefs.getInt(KEY_LAST_SEGMENT_INDEX, 0).coerceIn(0, mediaItems.size - 1)
                } else {
                    startIndex
                }
                val resumePosition = if (savedSession == sessionId && startPositionMs == 0L) {
                    prefs.getLong(KEY_LAST_POSITION_MS, 0L)
                } else {
                    startPositionMs
                }

                future.set(
                    MediaSession.MediaItemsWithStartPosition(
                        mediaItems, resumeIndex, resumePosition
                    )
                )
            } catch (e: Exception) {
                Log.e(TAG, "Failed to resolve session queue for $sessionId", e)
                future.set(
                    MediaSession.MediaItemsWithStartPosition(
                        emptyList(), startIndex, startPositionMs
                    )
                )
            }
        }

        return future
    }
}
