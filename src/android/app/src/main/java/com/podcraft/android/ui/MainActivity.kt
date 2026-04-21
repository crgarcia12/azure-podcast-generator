package com.podcraft.android.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.*
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.podcraft.android.api.ApiClient
import com.podcraft.android.ui.login.LoginScreen
import com.podcraft.android.ui.player.PlayerScreen
import com.podcraft.android.ui.sessions.SessionListScreen
import com.podcraft.android.ui.theme.PodCraftTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            PodCraftTheme {
                val navController = rememberNavController()
                val startDest = if (ApiClient.isLoggedIn()) "sessions" else "login"

                NavHost(navController = navController, startDestination = startDest) {
                    composable("login") {
                        LoginScreen(
                            onLoginSuccess = {
                                navController.navigate("sessions") {
                                    popUpTo("login") { inclusive = true }
                                }
                            }
                        )
                    }
                    composable("sessions") {
                        SessionListScreen(
                            onSessionClick = { sessionId ->
                                navController.navigate("player/$sessionId")
                            },
                            onLogout = {
                                navController.navigate("login") {
                                    popUpTo("sessions") { inclusive = true }
                                }
                            }
                        )
                    }
                    composable("player/{sessionId}") { backStackEntry ->
                        val sessionId = backStackEntry.arguments?.getString("sessionId") ?: ""
                        PlayerScreen(
                            sessionId = sessionId,
                            onBack = { navController.popBackStack() }
                        )
                    }
                }
            }
        }
    }
}
