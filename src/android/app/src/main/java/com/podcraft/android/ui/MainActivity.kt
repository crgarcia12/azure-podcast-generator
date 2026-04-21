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
import androidx.compose.material.icons.filled.Settings
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
import com.podcraft.android.ui.admin.AdminScreen
import com.podcraft.android.ui.home.HomeScreen
import com.podcraft.android.ui.login.LoginScreen
import com.podcraft.android.ui.player.PlayerScreen
import com.podcraft.android.ui.podcasts.PodcastStudioScreen
import com.podcraft.android.ui.profile.ProfileScreen
import com.podcraft.android.ui.register.RegisterScreen
import com.podcraft.android.ui.sessions.SessionDetailScreen
import com.podcraft.android.ui.sessions.SessionListScreen
import com.podcraft.android.ui.settings.SettingsScreen
import com.podcraft.android.ui.theme.PodCraftTheme

private data class BottomNavItem(val route: String, val label: String, val icon: ImageVector)

private val bottomNavItems = listOf(
    BottomNavItem("home", "Home", Icons.Filled.Home),
    BottomNavItem("studio", "Studio", Icons.Filled.Mic),
    BottomNavItem("sessions", "Sessions", Icons.Filled.QueueMusic),
    BottomNavItem("profile", "Profile", Icons.Filled.Person),
    BottomNavItem("settings", "Settings", Icons.Filled.Settings),
)

private val routesWithBottomBar = setOf("home", "studio", "sessions", "profile", "settings")

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

                fun navigateToLogin() {
                    navController.navigate("login") {
                        popUpTo(0) { inclusive = true }
                    }
                }

                fun logout() {
                    ApiClient.clearAuth()
                    navigateToLogin()
                }

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
                                onNavigateToLogin = { navigateToLogin() },
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
                                onLogout = { logout() },
                            )
                        }
                        composable("sessions") {
                            SessionListScreen(
                                onSessionClick = { sessionId ->
                                    navController.navigate("session/$sessionId")
                                },
                                onLogout = { logout() },
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
                                onNavigateToAdmin = {
                                    navController.navigate("admin")
                                },
                                onLogout = { logout() },
                            )
                        }
                        composable("settings") {
                            SettingsScreen(
                                onLogout = { logout() },
                            )
                        }
                        composable("admin") {
                            AdminScreen()
                        }
                        composable("session/{sessionId}") { backStackEntry ->
                            val sessionId = backStackEntry.arguments?.getString("sessionId") ?: ""
                            SessionDetailScreen(
                                sessionId = sessionId,
                                onBack = { navController.popBackStack() },
                                onPlaySession = { id ->
                                    navController.navigate("player/$id")
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
