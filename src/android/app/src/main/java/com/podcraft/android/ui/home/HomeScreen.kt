package com.podcraft.android.ui.home

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.podcraft.android.api.ApiClient

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    onNavigateToLogin: () -> Unit,
    onNavigateToStudio: () -> Unit,
) {
    var authenticated by remember { mutableStateOf<Boolean?>(null) }

    LaunchedEffect(Unit) {
        authenticated = try {
            val res = ApiClient.get().getMe()
            res.isSuccessful
        } catch (_: Exception) {
            false
        }
    }

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "🎙",
                style = MaterialTheme.typography.displayLarge,
            )

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "Turn any topic into a",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            )

            Text(
                text = "podcast episode",
                style = MaterialTheme.typography.headlineMedium,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary,
                textAlign = TextAlign.Center,
            )

            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "Enter a subject, and PodCraft generates an engaging interview-style script with two AI voices — ready to listen in seconds.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )

            Spacer(modifier = Modifier.height(32.dp))

            // Feature cards
            FeatureItem(emoji = "✍️", title = "AI-Written Scripts", description = "Natural host-and-guest dialogue with narrative arc and conversational flow.")
            Spacer(modifier = Modifier.height(12.dp))
            FeatureItem(emoji = "🗣️", title = "Natural Speech", description = "Azure Speech synthesizes the script with two distinct voices.")
            Spacer(modifier = Modifier.height(12.dp))
            FeatureItem(emoji = "📱", title = "Listen Anywhere", description = "Generate and listen on the go. Download episodes to keep them forever.")

            Spacer(modifier = Modifier.height(32.dp))

            when (authenticated) {
                null -> CircularProgressIndicator(modifier = Modifier.size(24.dp))
                true -> {
                    Button(
                        onClick = onNavigateToStudio,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) {
                        Text("🎧 Open Studio")
                    }
                }
                false -> {
                    Button(
                        onClick = onNavigateToLogin,
                        modifier = Modifier.fillMaxWidth().height(48.dp),
                    ) {
                        Text("Sign in to start")
                    }
                }
            }
        }
    }
}

@Composable
private fun FeatureItem(emoji: String, title: String, description: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(text = emoji, style = MaterialTheme.typography.titleLarge)
        Column {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
