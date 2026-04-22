package com.podcraft.android.ui.player

import android.content.ComponentName
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.SkipNext
import androidx.compose.material.icons.filled.SkipPrevious
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.media3.common.MediaItem
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.MoreExecutors
import com.podcraft.android.api.ApiClient
import com.podcraft.android.api.Session
import com.podcraft.android.playback.PlaybackService
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlayerScreen(sessionId: String, onBack: () -> Unit) {
    val context = LocalContext.current
    var session by remember { mutableStateOf<Session?>(null) }
    var loading by remember { mutableStateOf(true) }
    var controllerReady by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var controller by remember { mutableStateOf<MediaController?>(null) }
    var isPlaying by remember { mutableStateOf(false) }
    var currentIndex by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()

    // Load session data
    LaunchedEffect(sessionId) {
        try {
            val res = ApiClient.get().getSession(sessionId)
            if (res.isSuccessful) {
                session = res.body()?.session
            } else {
                error = "Failed to load session"
            }
        } catch (e: Exception) {
            error = "Network error"
        }
        loading = false
    }

    // Connect to MediaController
    LaunchedEffect(Unit) {
        val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
        val future = MediaController.Builder(context, token).buildAsync()
        future.addListener({
            try {
                val ctrl = future.get()
                controller = ctrl
                controllerReady = true
                ctrl.addListener(object : androidx.media3.common.Player.Listener {
                    override fun onIsPlayingChanged(playing: Boolean) {
                        isPlaying = playing
                    }
                    override fun onMediaItemTransition(
                        mediaItem: androidx.media3.common.MediaItem?,
                        reason: Int,
                    ) {
                        currentIndex = ctrl.currentMediaItemIndex
                    }
                })
            } catch (_: Exception) {}
        }, MoreExecutors.directExecutor())
    }

    DisposableEffect(Unit) {
        onDispose {
            controller?.release()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(session?.title ?: "Loading…") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        if (loading) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator()
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Loading session…", style = MaterialTheme.typography.bodySmall)
                }
            }
            return@Scaffold
        }

        if (error != null || session == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(error ?: "Session not found", color = MaterialTheme.colorScheme.error)
                    if (!controllerReady) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            "Connecting to player…",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            return@Scaffold
        }

        val sess = session!!
        val segment = sess.segments.getOrNull(currentIndex)

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Session info
            Text(
                text = sess.summary ?: sess.topic,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Segment indicator
            Text(
                text = "Segment ${currentIndex + 1} of ${sess.segments.size}",
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.primary,
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Segment text
            if (segment != null) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.surfaceVariant
                    ),
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "Host",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = segment.hostLine,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = "Guest",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.secondary,
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = segment.guestLine,
                            style = MaterialTheme.typography.bodyMedium,
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(32.dp))

            // Playback controls
            Row(
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                FilledIconButton(
                    onClick = { controller?.seekToPreviousMediaItem() },
                    modifier = Modifier.size(48.dp),
                    enabled = currentIndex > 0,
                ) {
                    Icon(Icons.Filled.SkipPrevious, contentDescription = "Previous")
                }

                FilledIconButton(
                    onClick = {
                        val ctrl = controller ?: return@FilledIconButton
                        if (!ctrl.isPlaying && ctrl.mediaItemCount == 0 && sess.segments.isNotEmpty()) {
                            // First play — load session via MediaController (works for both phone and Auto)
                            val sessionItem = MediaItem.Builder()
                                .setMediaId("play_all:$sessionId")
                                .build()
                            ctrl.setMediaItem(sessionItem)
                            ctrl.prepare()
                            ctrl.play()
                        } else {
                            if (ctrl.isPlaying) ctrl.pause() else ctrl.play()
                        }
                    },
                    modifier = Modifier.size(64.dp),
                    enabled = controllerReady,
                ) {
                    Icon(
                        if (isPlaying) Icons.Filled.Pause else Icons.Filled.PlayArrow,
                        contentDescription = if (isPlaying) "Pause" else "Play",
                        modifier = Modifier.size(32.dp),
                    )
                }

                FilledIconButton(
                    onClick = { controller?.seekToNextMediaItem() },
                    modifier = Modifier.size(48.dp),
                    enabled = currentIndex < sess.segments.size - 1,
                ) {
                    Icon(Icons.Filled.SkipNext, contentDescription = "Next")
                }
            }
        }
    }
}
