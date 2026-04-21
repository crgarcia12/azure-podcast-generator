package com.podcraft.android.ui.sessions

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.podcraft.android.api.ApiClient
import com.podcraft.android.api.ChatMessage
import com.podcraft.android.api.ChatRequest
import com.podcraft.android.api.Interrupt
import com.podcraft.android.api.Segment
import com.podcraft.android.api.Session
import kotlinx.coroutines.launch
import java.util.UUID

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SessionDetailScreen(
    sessionId: String,
    onBack: () -> Unit,
    onPlaySession: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    var session by remember { mutableStateOf<Session?>(null) }
    var chatMessages by remember { mutableStateOf<List<ChatMessage>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var showChat by remember { mutableStateOf(false) }
    var questionText by remember { mutableStateOf("") }
    var sending by remember { mutableStateOf(false) }
    val listState = rememberLazyListState()

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

    fun loadChat() {
        scope.launch {
            try {
                val res = ApiClient.get().getChatMessages(sessionId)
                if (res.isSuccessful) {
                    chatMessages = res.body()?.messages ?: emptyList()
                }
            } catch (_: Exception) { }
        }
    }

    fun sendQuestion() {
        val text = questionText.trim()
        if (text.isEmpty() || session == null) return
        val lastSegment = session!!.segments.lastOrNull() ?: return

        scope.launch {
            sending = true
            try {
                val req = ChatRequest(
                    message = text,
                    inputMethod = "text",
                    afterSegmentId = lastSegment.id,
                    clientRequestId = UUID.randomUUID().toString(),
                )
                val res = ApiClient.get().sendChatMessage(sessionId, req)
                if (res.isSuccessful) {
                    questionText = ""
                    val chatRes = res.body()
                    if (chatRes?.session != null) {
                        session = chatRes.session
                    } else {
                        loadSession()
                    }
                    loadChat()
                } else {
                    error = "Failed to send question"
                }
            } catch (e: Exception) {
                error = e.message ?: "Failed to send"
            }
            sending = false
        }
    }

    LaunchedEffect(sessionId) {
        loadSession()
        loadChat()
    }

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
                    // Toggle chat view
                    IconButton(onClick = { showChat = !showChat }) {
                        Icon(
                            if (showChat) Icons.Filled.GraphicEq else Icons.Filled.Chat,
                            contentDescription = if (showChat) "Transcript" else "Chat",
                            tint = MaterialTheme.colorScheme.primary
                        )
                    }
                    if (session != null && session!!.segments.isNotEmpty()) {
                        IconButton(onClick = { onPlaySession(sessionId) }) {
                            Icon(Icons.Filled.PlayCircle, contentDescription = "Play", tint = MaterialTheme.colorScheme.primary)
                        }
                    }
                }
            )
        },
        bottomBar = {
            // Chat input bar
            if (session != null && session!!.segments.isNotEmpty()) {
                Surface(tonalElevation = 3.dp) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        OutlinedTextField(
                            value = questionText,
                            onValueChange = { if (it.length <= 500) questionText = it },
                            modifier = Modifier.weight(1f),
                            placeholder = { Text("Ask a question…") },
                            singleLine = true,
                            enabled = !sending,
                            shape = RoundedCornerShape(24.dp),
                        )
                        Spacer(Modifier.width(8.dp))
                        IconButton(
                            onClick = { sendQuestion() },
                            enabled = !sending && questionText.isNotBlank()
                        ) {
                            if (sending) {
                                CircularProgressIndicator(modifier = Modifier.size(24.dp), strokeWidth = 2.dp)
                            } else {
                                Icon(
                                    Icons.AutoMirrored.Filled.Send,
                                    contentDescription = "Send",
                                    tint = if (questionText.isNotBlank()) MaterialTheme.colorScheme.primary
                                           else MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            }
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
                    if (showChat) {
                        ChatView(chatMessages, listState)
                    } else {
                        SessionContent(session!!)
                    }
                }
            }
        }
    }
}

@Composable
private fun ChatView(messages: List<ChatMessage>, listState: androidx.compose.foundation.lazy.LazyListState) {
    if (messages.isEmpty()) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    Icons.Filled.Chat,
                    contentDescription = null,
                    modifier = Modifier.size(48.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    "No messages yet",
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Text(
                    "Ask a question to interact with the podcast!",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                )
            }
        }
        return
    }

    LaunchedEffect(messages.size) {
        if (messages.isNotEmpty()) listState.animateScrollToItem(messages.size - 1)
    }

    LazyColumn(
        state = listState,
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(messages, key = { it.id }) { msg ->
            val isUser = msg.role == "user"
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
            ) {
                Box(
                    modifier = Modifier
                        .widthIn(max = 300.dp)
                        .clip(
                            RoundedCornerShape(
                                topStart = 16.dp, topEnd = 16.dp,
                                bottomStart = if (isUser) 16.dp else 4.dp,
                                bottomEnd = if (isUser) 4.dp else 16.dp
                            )
                        )
                        .background(
                            if (isUser) MaterialTheme.colorScheme.primaryContainer
                            else MaterialTheme.colorScheme.surfaceVariant
                        )
                        .padding(12.dp)
                ) {
                    Text(
                        msg.content,
                        style = MaterialTheme.typography.bodyMedium,
                        color = if (isUser) MaterialTheme.colorScheme.onPrimaryContainer
                               else MaterialTheme.colorScheme.onSurfaceVariant
                    )
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
