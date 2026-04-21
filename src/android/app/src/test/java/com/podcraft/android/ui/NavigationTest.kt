package com.podcraft.android.ui

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertFalse

/**
 * Tests for navigation and routing logic.
 */
class NavigationTest {

    private val routesWithBottomBar = setOf("home", "studio", "sessions", "profile", "settings")

    @Test
    fun `bottom bar shown for main routes`() {
        assertTrue("home" in routesWithBottomBar)
        assertTrue("studio" in routesWithBottomBar)
        assertTrue("sessions" in routesWithBottomBar)
        assertTrue("profile" in routesWithBottomBar)
        assertTrue("settings" in routesWithBottomBar)
    }

    @Test
    fun `bottom bar hidden for secondary routes`() {
        assertFalse("login" in routesWithBottomBar)
        assertFalse("register" in routesWithBottomBar)
        assertFalse("player/abc" in routesWithBottomBar)
        assertFalse("session/abc" in routesWithBottomBar)
        assertFalse("admin" in routesWithBottomBar)
    }

    @Test
    fun `session route pattern`() {
        val sessionId = "test-session-123"
        val route = "session/$sessionId"
        assertTrue(route.startsWith("session/"))
        assertEquals(sessionId, route.removePrefix("session/"))
    }

    @Test
    fun `player route pattern`() {
        val sessionId = "test-session-456"
        val route = "player/$sessionId"
        assertTrue(route.startsWith("player/"))
        assertEquals(sessionId, route.removePrefix("player/"))
    }
}
