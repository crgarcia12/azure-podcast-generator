package com.podcraft.android.ui.sessions

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.podcraft.android.api.ApiClient
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
    val scope = rememberCoroutineScope()

    fun loadSessions() {
        scope.launch {
            loading = true
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

    LaunchedEffect(Unit) { loadSessions() }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("🎙 Your Sessions") },
                actions = {
                    IconButton(onClick = {
                        scope.launch {
                            try { ApiClient.get().logout() } catch (_: Exception) {}
                            ApiClient.clearAuth()
                            onLogout()
                        }
                    }) {
                        Icon(Icons.AutoMirrored.Filled.ExitToApp, contentDescription = "Sign out")
                    }
                }
            )
        }
    ) { padding ->
        when {
            loading -> {
                Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
            }
            error != null -> {
                Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(error!!, color = MaterialTheme.colorScheme.error)
                        Spacer(modifier = Modifier.height(8.dp))
                        TextButton(onClick = { loadSessions() }) { Text("Retry") }
                    }
                }
            }
            sessions.isEmpty() -> {
                Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("No sessions yet", style = MaterialTheme.typography.titleMedium)
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            "Create a podcast on the web",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
            else -> {
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(padding),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    items(sessions, key = { it.id }) { session ->
                        SessionCard(session = session, onClick = { onSessionClick(session.id) })
                    }
                }
            }
        }
    }
}

@Composable
private fun SessionCard(session: SessionSummary, onClick: () -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onClick),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text(
                text = session.title,
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = session.topic,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(modifier = Modifier.height(8.dp))
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
                        color = MaterialTheme.colorScheme.secondary,
                    )
                }
            }
        }
    }
}
