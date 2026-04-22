package com.podcraft.android.ui.podcasts

import androidx.compose.animation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.podcraft.android.api.ApiClient
import com.podcraft.android.api.CreatePodcastRequest
import com.podcraft.android.api.PodcastEpisode
import com.podcraft.android.api.TranscriptTurn
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

private val GENERATING_MESSAGES = listOf(
    "🎙 Writing the script…",
    "✍️ Crafting the conversation…",
    "🗣️ Synthesizing voices…",
    "🎧 Mixing the audio…",
    "✨ Almost there…",
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PodcastStudioScreen(
    onNavigateToSessions: () -> Unit,
    onLogout: () -> Unit,
) {
    var topic by remember { mutableStateOf("") }
    var episodes by remember { mutableStateOf<List<PodcastEpisode>>(emptyList()) }
    var currentEpisode by remember { mutableStateOf<PodcastEpisode?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(true) }
    var submitting by remember { mutableStateOf(false) }
    var genMessage by remember { mutableStateOf(GENERATING_MESSAGES[0]) }
    val scope = rememberCoroutineScope()

    fun loadEpisodes() {
        scope.launch {
            try {
                val res = ApiClient.get().listPodcasts()
                if (res.isSuccessful) {
                    episodes = res.body()?.episodes ?: emptyList()
                }
            } catch (_: Exception) { }
        }
    }

    LaunchedEffect(Unit) {
        try {
            val authRes = ApiClient.get().getMe()
            if (!authRes.isSuccessful) {
                if (authRes.code() == 401) {
                    ApiClient.clearAuth()
                    onLogout()
                    return@LaunchedEffect
                }
            }
            loadEpisodes()
        } catch (_: Exception) {
            error = "Unable to load the podcast studio right now."
        }
        loading = false
    }

    // Rotating generation messages
    LaunchedEffect(submitting) {
        if (!submitting) return@LaunchedEffect
        var idx = 0
        while (submitting) {
            delay(4000)
            idx = (idx + 1) % GENERATING_MESSAGES.size
            genMessage = GENERATING_MESSAGES[idx]
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("🎙 Podcast Studio") })
        }
    ) { padding ->
        if (loading) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
            return@Scaffold
        }

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            // Hero banner
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(
                        containerColor = MaterialTheme.colorScheme.primaryContainer,
                    ),
                ) {
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(20.dp)
                    ) {
                        Text(
                            text = "Create a new episode",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Enter any topic and PodCraft will write an interview script and synthesize it with two AI voices.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.8f),
                        )
                    }
                }
            }

            // Interactive sessions link
            item {
                OutlinedCard(
                    onClick = onNavigateToSessions,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "🎙️ Interactive Sessions",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.primary,
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Steer the conversation in real time with our interactive podcast session editor.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            // Generator form
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            text = "What should the episode be about?",
                            style = MaterialTheme.typography.labelLarge,
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        OutlinedTextField(
                            value = topic,
                            onValueChange = { if (it.length <= 120) topic = it },
                            modifier = Modifier.fillMaxWidth(),
                            placeholder = { Text("Try: \"The rise and fall of Blockbuster Video\"") },
                            maxLines = 3,
                            enabled = !submitting,
                            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                            keyboardActions = KeyboardActions(onDone = {
                                if (topic.isNotBlank() && !submitting) {
                                    scope.launch {
                                        generateEpisode(
                                            topic.trim(),
                                            { error = it },
                                            { submitting = it },
                                            { genMessage = GENERATING_MESSAGES[0] },
                                            { ep ->
                                                currentEpisode = ep
                                                episodes = listOf(ep) + episodes
                                                topic = ""
                                            },
                                            { draft -> currentEpisode = draft },
                                        )
                                    }
                                }
                            }),
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "${topic.length}/120",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )

                        if (error != null) {
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = error!!,
                                color = MaterialTheme.colorScheme.error,
                                style = MaterialTheme.typography.bodySmall,
                            )
                        }

                        Spacer(modifier = Modifier.height(12.dp))

                        if (submitting) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp),
                            ) {
                                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
                                Text(
                                    text = genMessage,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.primary,
                                )
                            }
                        } else {
                            Button(
                                onClick = {
                                    if (topic.isNotBlank()) {
                                        scope.launch {
                                            generateEpisode(
                                                topic.trim(),
                                                { error = it },
                                                { submitting = it },
                                                { genMessage = GENERATING_MESSAGES[0] },
                                                { ep ->
                                                    currentEpisode = ep
                                                    episodes = listOf(ep) + episodes
                                                    topic = ""
                                                },
                                                { draft -> currentEpisode = draft },
                                            )
                                        }
                                    }
                                },
                                enabled = topic.isNotBlank(),
                                modifier = Modifier.align(Alignment.End),
                            ) {
                                Text("✨ Generate episode")
                            }
                        }
                    }
                }
            }

            // Current episode
            if (currentEpisode != null) {
                item {
                    EpisodeCard(episode = currentEpisode!!, expandedByDefault = true)
                }
            }

            // Past episodes
            val otherEpisodes = episodes.filter { it.id != currentEpisode?.id }
            if (otherEpisodes.isNotEmpty()) {
                item {
                    Text(
                        text = "Your episodes",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
                items(otherEpisodes, key = { it.id }) { ep ->
                    EpisodeCard(episode = ep)
                }
            }
        }
    }
}

@Composable
private fun EpisodeCard(episode: PodcastEpisode, expandedByDefault: Boolean = false) {
    var showTranscript by remember { mutableStateOf(expandedByDefault) }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp)) {
            // Badge + date
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Surface(
                    shape = MaterialTheme.shapes.small,
                    color = MaterialTheme.colorScheme.primaryContainer,
                ) {
                    Text(
                        text = "Episode",
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                Text(
                    text = episode.createdAt.take(10),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = episode.title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
            )

            Spacer(modifier = Modifier.height(4.dp))

            Text(
                text = episode.summary,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 3,
                overflow = TextOverflow.Ellipsis,
            )

            Spacer(modifier = Modifier.height(8.dp))

            if (!episode.audioAvailable) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = MaterialTheme.shapes.small,
                ) {
                    Text(
                        text = "Script ready — audio synthesis was unavailable",
                        modifier = Modifier.padding(8.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                    )
                }
            }

            // Transcript toggle
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (episode.audioAvailable) {
                    FilledTonalIconButton(
                        onClick = {
                            // Play audio via system media player intent
                            // In a full impl, route through PlaybackService
                        },
                        modifier = Modifier.size(36.dp),
                    ) {
                        Icon(
                            Icons.Filled.PlayArrow,
                            contentDescription = "Play episode audio",
                            modifier = Modifier.size(20.dp),
                        )
                    }
                    Spacer(modifier = Modifier.width(8.dp))
                }

                TextButton(
                    onClick = { showTranscript = !showTranscript },
                    modifier = Modifier.weight(1f),
                ) {
                    Text("Transcript (${episode.transcript.size} turns)")
                    Spacer(modifier = Modifier.weight(1f))
                    Icon(
                        if (showTranscript) Icons.Filled.ExpandLess else Icons.Filled.ExpandMore,
                        contentDescription = if (showTranscript) "Collapse transcript" else "Expand transcript",
                    )
                }
            }

            AnimatedVisibility(visible = showTranscript) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    episode.transcript.forEach { turn ->
                        TranscriptTurnRow(turn)
                    }
                }
            }
        }
    }
}

@Composable
private fun TranscriptTurnRow(turn: TranscriptTurn) {
    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Surface(
            shape = MaterialTheme.shapes.small,
            color = if (turn.speaker == "host") MaterialTheme.colorScheme.primaryContainer
                else MaterialTheme.colorScheme.secondaryContainer,
        ) {
            Text(
                text = if (turn.speaker == "host") "H" else "G",
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = if (turn.speaker == "host") MaterialTheme.colorScheme.primary
                    else MaterialTheme.colorScheme.secondary,
            )
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = turn.speakerLabel,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(2.dp))
            Text(
                text = turn.text,
                style = MaterialTheme.typography.bodySmall,
            )
        }
    }
}

private suspend fun generateEpisode(
    topic: String,
    setError: (String?) -> Unit,
    setSubmitting: (Boolean) -> Unit,
    resetGenMessage: () -> Unit,
    onSuccess: (PodcastEpisode) -> Unit,
    onDraft: (PodcastEpisode) -> Unit,
) {
    setSubmitting(true)
    setError(null)
    resetGenMessage()
    try {
        val res = ApiClient.get().createPodcast(CreatePodcastRequest(topic))
        if (res.isSuccessful) {
            val ep = res.body()?.episode
            if (ep != null) {
                onSuccess(ep)
            }
        } else {
            val body = res.errorBody()?.string() ?: ""
            val draft = res.body()?.draftEpisode
            if (draft != null) onDraft(draft)
            setError(
                if (body.contains("error")) {
                    try {
                        kotlinx.serialization.json.Json { ignoreUnknownKeys = true }
                            .decodeFromString<com.podcraft.android.api.ErrorResponse>(body).error
                    } catch (_: Exception) { "Unable to create a podcast right now." }
                } else "Unable to create a podcast right now."
            )
        }
    } catch (_: Exception) {
        setError("Network error — check your connection")
    }
    setSubmitting(false)
}
