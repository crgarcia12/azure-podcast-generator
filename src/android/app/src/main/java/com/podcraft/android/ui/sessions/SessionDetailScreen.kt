package com.podcraft.android.ui.sessions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.podcraft.android.api.ApiClient
import com.podcraft.android.api.Interrupt
import com.podcraft.android.api.Segment
import com.podcraft.android.api.Session
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionDetailScreen(
    sessionId: String,
    onBack: () -> Unit,
    onPlaySession: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    var session by remember { mutableStateOf<Session?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    fun loadSession() {
        scope.launch {
            loading = true
            error = null
            try {
                val res = ApiClient.get().getSession(sessionId)
                if (res.isSuccessful) {
                    session = res.body()?.session
                } else {
                    error = "Failed to load session (${res.code()})"
                }
            } catch (e: Exception) {
                error = e.message ?: "Network error"
            }
            loading = false
        }
    }

    LaunchedEffect(sessionId) { loadSession() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(session?.title ?: "Session Details") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
                actions = {
                    if (session != null && session!!.segments.isNotEmpty()) {
                        IconButton(onClick = { onPlaySession(sessionId) }) {
                            Icon(Icons.Filled.PlayCircle, contentDescription = "Play", tint = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when {
                loading -> {
                    CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
                }
                error != null -> {
                    Column(
                        modifier = Modifier.align(Alignment.Center).padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(error!!, color = MaterialTheme.colorScheme.error)
                        Spacer(Modifier.height(16.dp))
                        Button(onClick = { loadSession() }) { Text("Retry") }
                    }
                }
                session != null -> {
                    SessionContent(session!!)
                }
            }
        }
    }
}

@Composable
private fun SessionContent(session: Session) {
    LazyColumn(
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        // Session info card
        item {
            Card(
                modifier = Modifier.fillMaxWidth(),
                shape = RoundedCornerShape(16.dp)
            ) {
                Column(modifier = Modifier.padding(16.dp)) {
                    Text(session.title, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                    Spacer(Modifier.height(4.dp))
                    Text(session.topic, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (session.summary != null) {
                        Spacer(Modifier.height(8.dp))
                        Text(session.summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                        InfoChip("${session.segments.size} segments", Icons.Filled.GraphicEq)
                        InfoChip("${session.interrupts.size} interrupts", Icons.Filled.QuestionAnswer)
                        InfoChip("Rev ${session.revision}", Icons.Filled.History)
                    }
                }
            }
        }

        // Transcript header
        if (session.segments.isNotEmpty()) {
            item {
                Text(
                    "Transcript",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.padding(top = 16.dp, bottom = 4.dp)
                )
            }
        }

        // Interleave segments and interrupts
        val interruptMap = session.interrupts.associateBy { it.afterSegmentId }

        items(session.segments) { segment ->
            SegmentCard(segment)

            // Show interrupt after this segment if any
            val interrupt = interruptMap[segment.id]
            if (interrupt != null) {
                InterruptCard(interrupt)
            }
        }

        // Bottom spacer
        item { Spacer(Modifier.height(32.dp)) }
    }
}

@Composable
private fun InfoChip(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, contentDescription = null, modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(4.dp))
        Text(text, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun SegmentCard(segment: Segment) {
    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(4.dp)
    ) {
        // Host line
        Row(modifier = Modifier.fillMaxWidth()) {
            Box(
                modifier = Modifier
                    .weight(0.85f)
                    .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomEnd = 16.dp, bottomStart = 4.dp))
                    .background(MaterialTheme.colorScheme.primaryContainer)
                    .padding(12.dp)
            ) {
                Column {
                    Text(
                        "🎙 Host",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        segment.hostLine,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }
            }
            Spacer(Modifier.weight(0.15f))
        }

        // Guest line
        Row(modifier = Modifier.fillMaxWidth()) {
            Spacer(Modifier.weight(0.15f))
            Box(
                modifier = Modifier
                    .weight(0.85f)
                    .clip(RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomStart = 16.dp, bottomEnd = 4.dp))
                    .background(MaterialTheme.colorScheme.secondaryContainer)
                    .padding(12.dp)
            ) {
                Column {
                    Text(
                        "🎤 Guest",
                        style = MaterialTheme.typography.labelSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.secondary
                    )
                    Spacer(Modifier.height(4.dp))
                    Text(
                        segment.guestLine,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSecondaryContainer
                    )
                }
            }
        }

        Spacer(Modifier.height(4.dp))
    }
}

@Composable
private fun InterruptCard(interrupt: Interrupt) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.tertiaryContainer)
    ) {
        Row(
            modifier = Modifier.padding(12.dp),
            verticalAlignment = Alignment.Top
        ) {
            Icon(
                Icons.Filled.QuestionAnswer,
                contentDescription = null,
                modifier = Modifier.size(20.dp),
                tint = MaterialTheme.colorScheme.tertiary
            )
            Spacer(Modifier.width(8.dp))
            Column {
                Text(
                    "Listener Question",
                    style = MaterialTheme.typography.labelSmall,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.tertiary
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    interrupt.questionText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "via ${interrupt.inputMethod}",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onTertiaryContainer.copy(alpha = 0.6f)
                )
            }
        }
    }
}
