package com.podcraft.android.ui.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.podcraft.android.api.ApiClient
import com.podcraft.android.api.AuthUser
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    onNavigateToStudio: () -> Unit,
    onNavigateToAdmin: () -> Unit = {},
    onLogout: () -> Unit,
) {
    var user by remember { mutableStateOf<AuthUser?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    fun loadProfile() {
        scope.launch {
            loading = true
            error = false
            try {
                val res = ApiClient.get().getMe()
                if (res.isSuccessful) {
                    user = res.body()
                } else if (res.code() == 401) {
                    ApiClient.clearAuth()
                    onLogout()
                    return@launch
                } else {
                    error = true
                }
            } catch (_: Exception) {
                error = true
            }
            loading = false
        }
    }

    LaunchedEffect(Unit) { loadProfile() }

    Scaffold(
        topBar = {
            TopAppBar(title = { Text("Profile") })
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            contentAlignment = Alignment.Center,
        ) {
            when {
                loading -> CircularProgressIndicator()
                error -> {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text("Failed to load profile", color = MaterialTheme.colorScheme.error)
                        Spacer(modifier = Modifier.height(8.dp))
                        TextButton(onClick = { loadProfile() }) { Text("Retry") }
                    }
                }
                user != null -> {
                    val u = user!!
                    Column(
                        modifier = Modifier.padding(horizontal = 24.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        // Avatar
                        Box(
                            modifier = Modifier
                                .size(80.dp)
                                .clip(CircleShape)
                                .background(
                                    Brush.linearGradient(
                                        listOf(
                                            MaterialTheme.colorScheme.primary,
                                            MaterialTheme.colorScheme.secondary,
                                        )
                                    )
                                ),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = u.username.first().uppercase(),
                                fontSize = 32.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onPrimary,
                            )
                        }

                        Spacer(modifier = Modifier.height(16.dp))

                        Text(
                            text = u.username,
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Bold,
                        )

                        Spacer(modifier = Modifier.height(8.dp))

                        Surface(
                            shape = MaterialTheme.shapes.small,
                            color = MaterialTheme.colorScheme.primaryContainer,
                        ) {
                            Text(
                                text = u.role,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.primary,
                            )
                        }

                        Spacer(modifier = Modifier.height(8.dp))

                        Text(
                            text = "Member since ${formatDate(u.createdAt)}",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )

                        Spacer(modifier = Modifier.height(32.dp))

                        if (u.role == "admin") {
                            OutlinedButton(
                                onClick = onNavigateToAdmin,
                                modifier = Modifier.fillMaxWidth().height(48.dp),
                                colors = ButtonDefaults.outlinedButtonColors(
                                    contentColor = MaterialTheme.colorScheme.primary
                                ),
                            ) {
                                Text("🛡️ Admin Panel")
                            }
                            Spacer(modifier = Modifier.height(12.dp))
                        }

                        Button(
                            onClick = onNavigateToStudio,
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                        ) {
                            Text("🎙 Open Studio")
                        }

                        Spacer(modifier = Modifier.height(12.dp))

                        OutlinedButton(
                            onClick = {
                                scope.launch {
                                    try { ApiClient.get().logout() } catch (_: Exception) {}
                                    ApiClient.clearAuth()
                                    onLogout()
                                }
                            },
                            modifier = Modifier.fillMaxWidth().height(48.dp),
                        ) {
                            Text("Logout")
                        }
                    }
                }
            }
        }
    }
}

private fun formatDate(isoDate: String): String {
    return try {
        val parser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
        parser.timeZone = TimeZone.getTimeZone("UTC")
        val date = parser.parse(isoDate) ?: return isoDate
        val formatter = SimpleDateFormat("MMMM d, yyyy", Locale.US)
        formatter.format(date)
    } catch (_: Exception) {
        isoDate
    }
}
