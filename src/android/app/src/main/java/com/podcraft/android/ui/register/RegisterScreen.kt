package com.podcraft.android.ui.register

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.podcraft.android.api.ApiClient
import com.podcraft.android.api.RegisterRequest
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RegisterScreen(
    onRegisterSuccess: () -> Unit,
    onNavigateToLogin: () -> Unit,
) {
    var username by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var loading by remember { mutableStateOf(false) }
    var registrationEnabled by remember { mutableStateOf<Boolean?>(null) }
    val scope = rememberCoroutineScope()

    LaunchedEffect(Unit) {
        try {
            val res = ApiClient.get().getRegistrationStatus()
            registrationEnabled = if (res.isSuccessful) res.body()?.enabled ?: false else false
        } catch (_: Exception) {
            registrationEnabled = false
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
            when (registrationEnabled) {
                null -> {
                    CircularProgressIndicator()
                }
                false -> {
                    Text("🔒", style = MaterialTheme.typography.displayMedium)
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = "Registration Closed",
                        style = MaterialTheme.typography.headlineMedium,
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "New account registration is currently disabled. Please contact an administrator.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(modifier = Modifier.height(24.dp))
                    OutlinedButton(onClick = onNavigateToLogin) {
                        Text("Sign in instead")
                    }
                }
                true -> {
                    Text(
                        text = "🎙 Create Account",
                        style = MaterialTheme.typography.headlineLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = "Join PodCraft and start generating podcasts",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )

                    Spacer(modifier = Modifier.height(32.dp))

                    OutlinedTextField(
                        value = username,
                        onValueChange = { username = it },
                        label = { Text("Username") },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                        enabled = !loading,
                    )

                    Spacer(modifier = Modifier.height(12.dp))

                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        label = { Text("Password") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = {
                            if (username.isNotBlank() && password.isNotBlank() && !loading) {
                                scope.launch { doRegister(username, password, { error = it }, { loading = it }, onRegisterSuccess) }
                            }
                        }),
                        enabled = !loading,
                    )

                    if (error != null) {
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = error!!,
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }

                    Spacer(modifier = Modifier.height(24.dp))

                    Button(
                        onClick = {
                            scope.launch { doRegister(username, password, { error = it }, { loading = it }, onRegisterSuccess) }
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(48.dp),
                        enabled = username.isNotBlank() && password.isNotBlank() && !loading,
                    ) {
                        if (loading) {
                            CircularProgressIndicator(
                                modifier = Modifier.size(20.dp),
                                color = MaterialTheme.colorScheme.onPrimary,
                                strokeWidth = 2.dp,
                            )
                        } else {
                            Text("Create account")
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    TextButton(onClick = onNavigateToLogin) {
                        Text("Already have an account? Sign in")
                    }
                }
            }
        }
    }
}

private suspend fun doRegister(
    username: String,
    password: String,
    setError: (String?) -> Unit,
    setLoading: (Boolean) -> Unit,
    onSuccess: () -> Unit,
) {
    setLoading(true)
    setError(null)
    try {
        val res = ApiClient.get().register(RegisterRequest(username, password))
        if (res.isSuccessful) {
            onSuccess()
        } else {
            val body = res.errorBody()?.string() ?: ""
            val msg = if (body.contains("Username already exists")) "Username already exists"
                else if (body.contains("closed")) "Registration is currently closed"
                else if (body.contains("Password must")) "Password must be at least 8 characters"
                else if (body.contains("Username must")) "Username must be 3-30 characters (letters, numbers, underscores)"
                else "Registration failed"
            setError(msg)
        }
    } catch (_: Exception) {
        setError("Network error — check your connection")
    }
    setLoading(false)
}
