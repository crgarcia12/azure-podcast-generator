package com.podcraft.android.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.QueueMusic
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.podcraft.android.api.ApiClient
import com.podcraft.android.ui.home.HomeScreen
import com.podcraft.android.ui.login.LoginScreen
import com.podcraft.android.ui.player.PlayerScreen
import com.podcraft.android.ui.podcasts.PodcastStudioScreen
import com.podcraft.android.ui.profile.ProfileScreen
import com.podcraft.android.ui.register.RegisterScreen
import com.podcraft.android.ui.sessions.SessionListScreen
import com.podcraft.android.ui.theme.PodCraftTheme

private data class BottomNavItem(val route: String, val label: String, val icon: ImageVector)

private val bottomNavItems = listOf(
    BottomNavItem("home", "Home", Icons.Filled.Home),
    BottomNavItem("studio", "Studio", Icons.Filled.Mic),
    BottomNavItem("sessions", "Sessions", Icons.Filled.QueueMusic),
    BottomNavItem("profile", "Profile", Icons.Filled.Person),
)

private val routesWithBottomBar = setOf("home", "studio", "sessions", "profile")

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            PodCraftTheme {
                val navController = rememberNavController()
                val startDest = if (ApiClient.isLoggedIn()) "home" else "login"
                val navBackStackEntry by navController.currentBackStackEntryAsState()
                val currentRoute = navBackStackEntry?.destination?.route

                Scaffold(
                    bottomBar = {
                        if (currentRoute in routesWithBottomBar) {
                            NavigationBar {
                                bottomNavItems.forEach { item ->
                                    NavigationBarItem(
                                        selected = currentRoute == item.route,
                                        onClick = {
                                            navController.navigate(item.route) {
                                                popUpTo(navController.graph.findStartDestination().id) {
                                                    saveState = true
                                                }
                                                launchSingleTop = true
                                                restoreState = true
                                            }
                                        },
                                        icon = { Icon(item.icon, contentDescription = item.label) },
                                        label = { Text(item.label) },
                                    )
                                }
                            }
                        }
                    }
                ) { innerPadding ->
                    NavHost(
                        navController = navController,
                        startDestination = startDest,
                        modifier = Modifier.consumeWindowInsets(innerPadding)
                            .padding(innerPadding),
                    ) {
                        composable("login") {
                            LoginScreen(
                                onLoginSuccess = {
                                    navController.navigate("home") {
                                        popUpTo("login") { inclusive = true }
                                    }
                                },
                                onNavigateToRegister = {
                                    navController.navigate("register")
                                },
                            )
                        }
                        composable("register") {
                            RegisterScreen(
                                onRegisterSuccess = {
                                    navController.navigate("home") {
                                        popUpTo("register") { inclusive = true }
                                        popUpTo("login") { inclusive = true }
                                    }
                                },
                                onNavigateToLogin = {
                                    navController.popBackStack()
                                },
                            )
                        }
                        composable("home") {
                            HomeScreen(
                                onNavigateToLogin = {
                                    navController.navigate("login") {
                                        popUpTo("home") { inclusive = true }
                                    }
                                },
                                onNavigateToStudio = {
                                    navController.navigate("studio") {
                                        popUpTo(navController.graph.findStartDestination().id) {
                                            saveState = true
                                        }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                            )
                        }
                        composable("studio") {
                            PodcastStudioScreen(
                                onNavigateToSessions = {
                                    navController.navigate("sessions") {
                                        popUpTo(navController.graph.findStartDestination().id) {
                                            saveState = true
                                        }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                                onLogout = {
                                    navController.navigate("login") {
                                        popUpTo(0) { inclusive = true }
                                    }
                                },
                            )
                        }
                        composable("sessions") {
                            SessionListScreen(
                                onSessionClick = { sessionId ->
                                    navController.navigate("player/$sessionId")
                                },
                                onLogout = {
                                    navController.navigate("login") {
                                        popUpTo(0) { inclusive = true }
                                    }
                                },
                            )
                        }
                        composable("profile") {
                            ProfileScreen(
                                onNavigateToStudio = {
                                    navController.navigate("studio") {
                                        popUpTo(navController.graph.findStartDestination().id) {
                                            saveState = true
                                        }
                                        launchSingleTop = true
                                        restoreState = true
                                    }
                                },
                                onLogout = {
                                    navController.navigate("login") {
                                        popUpTo(0) { inclusive = true }
                                    }
                                },
                            )
                        }
                        composable("player/{sessionId}") { backStackEntry ->
                            val sessionId = backStackEntry.arguments?.getString("sessionId") ?: ""
                            PlayerScreen(
                                sessionId = sessionId,
                                onBack = { navController.popBackStack() },
                            )
                        }
                    }
                }
            }
        }
    }
}
