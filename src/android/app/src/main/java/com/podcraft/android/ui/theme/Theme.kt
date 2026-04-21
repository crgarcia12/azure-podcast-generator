package com.podcraft.android.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val Purple = Color(0xFF7C3AED)
private val PurpleDark = Color(0xFF6D28D9)
private val Indigo = Color(0xFF4F46E5)

private val LightColors = lightColorScheme(
    primary = Purple,
    onPrimary = Color.White,
    primaryContainer = Color(0xFFEDE9FE),
    secondary = Indigo,
    background = Color(0xFFFAFAFA),
    surface = Color.White,
    error = Color(0xFFDC2626),
)

private val DarkColors = darkColorScheme(
    primary = Color(0xFFA78BFA),
    onPrimary = Color.Black,
    primaryContainer = PurpleDark,
    secondary = Color(0xFF818CF8),
    background = Color(0xFF0F0F0F),
    surface = Color(0xFF1A1A1A),
    error = Color(0xFFFCA5A5),
)

@Composable
fun PodCraftTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
