package com.podcraft.android.ui.sessions

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.podcraft.android.api.ApiClient
import com.podcraft.android.api.CreateSessionRequest
import com.podcraft.android.api.SessionSummary
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionListScreen(
    onSessionClick: (String) -> Unit,
    onLogout: () -> Unit,
) {
    var sessions by remember { mutableStateOf<List<SessionSummary>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var topic by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var showDeleteDialog by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()

    fun loadSessions() {
        scope.launch {
            loading = sessions.isEmpty()
            error = null
            try {
                val res = ApiClient.get().listSessions()
                if (res.isSuccessful) {
                    sessions = res.body()?.sessions ?: emptyList()
                } else if (res.code() == 401) {
                    ApiClient.clearAuth()
                    onLogout()
                    return@launch
                } else {
                    error = "Failed to load sessions"
                }
            } catch (e: Exception) {
                error = "Network error — check your connection"
            }
            loading = false
        }
    }

    fun createSession() {
        if (topic.isBlank()) return
        scope.launch {
            creating = true
            error = null
            try {
                val res = ApiClient.get().createSession(CreateSessionRequest(topic.trim()))
                if (res.isSuccessful) {
                    val session = res.body()?.session
                    topic = ""
                    if (session != null) {
                        onSessionClick(session.id)
                    }
                    loadSessions()
                } else {
                    error = "Failed to create session"
                }
            } catch (e: Exception) {
                error = e.message ?: "Network error"
            }
            creating = false
        }
    }

    fun deleteSession(sessionId: String) {
        scope.launch {
            try {
                ApiClient.get().deleteSession(sessionId)
                sessions = sessions.filter { it.id != sessionId }
            } catch (_: Exception) { }
            showDeleteDialog = null
        }
    }

    LaunchedEffect(Unit) { loadSessions() }

    // Delete confirmation dialog
    showDeleteDialog?.let { sessionId ->
        AlertDialog(
            onDismissRequest = { showDeleteDialog = null },
            title = { Text("Delete Session") },
            text = { Text("Are you sure you want to delete this session? This cannot be undone.") },
            confirmButton = {
                TextButton(
                    onClick = { deleteSession(sessionId) },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)
                ) { Text("Delete") }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteDialog = null }) { Text("Cancel") }
            }
        )
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text("🎙️", style = MaterialTheme.typography.headlineSmall)
                        Spacer(Modifier.width(8.dp))
                        Text("Interactive Sessions")
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            // Create session card
            item {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column(modifier = Modifier.padding(16.dp)) {
                        Text(
                            "Start a new interactive podcast",
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        Spacer(Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            OutlinedTextField(
                                value = topic,
                                onValueChange = { if (it.length <= 120) topic = it },
                                modifier = Modifier.weight(1f),
                                placeholder = { Text("Enter a topic…") },
                                singleLine = true,
                                enabled = !creating,
                                shape = RoundedCornerShape(12.dp)
                            )
                            Spacer(Modifier.width(8.dp))
                            Button(
                                onClick = { createSession() },
                                enabled = !creating && topic.isNotBlank(),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                if (creating) {
                                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp)
                                } else {
                                    Text("Create")
                                }
                            }
                        }
                    }
                }
            }

            // Error
            if (error != null) {
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.errorContainer),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text(
                            error!!,
                            modifier = Modifier.padding(16.dp),
                            color = MaterialTheme.colorScheme.onErrorContainer
                        )
                    }
                }
            }

            // Loading
            if (loading && sessions.isEmpty()) {
                item {
                    Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                        CircularProgressIndicator()
                    }
                }
            }

            // Empty state
            if (!loading && sessions.isEmpty()) {
                item {
                    Column(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 48.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(
                            Icons.Filled.Mic,
                            contentDescription = null,
                            modifier = Modifier.size(64.dp),
                            tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                        )
                        Spacer(Modifier.height(16.dp))
                        Text("No sessions yet", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(
                            "Create your first interactive podcast above!",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
                        )
                    }
                }
            }

            // Session header
            if (sessions.isNotEmpty()) {
                item {
                    Text(
                        "Past Sessions",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 8.dp)
                    )
                }
            }

            // Sessions list
            items(sessions, key = { it.id }) { session ->
                SessionCard(
                    session = session,
                    onClick = { onSessionClick(session.id) },
                    onDelete = { showDeleteDialog = session.id }
                )
            }
        }
    }
}

@Composable
private fun SessionCard(
    session: SessionSummary,
    onClick: () -> Unit,
    onDelete: () -> Unit
) {
    Card(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = session.title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Medium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = session.topic,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(modifier = Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text(
                        text = "${session.segmentCount} segments",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                    )
                    if (session.interruptCount > 0) {
                        Text(
                            text = "${session.interruptCount} interrupts",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.tertiary,
                        )
                    }
                    Text(
                        text = formatDate(session.createdAt),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            IconButton(onClick = onDelete) {
                Icon(
                    Icons.Filled.Delete,
                    contentDescription = "Delete",
                    tint = MaterialTheme.colorScheme.error.copy(alpha = 0.7f)
                )
            }
        }
    }
}

private fun formatDate(iso: String): String {
    return try {
        iso.substringBefore("T")
    } catch (_: Exception) {
        iso
    }
}
