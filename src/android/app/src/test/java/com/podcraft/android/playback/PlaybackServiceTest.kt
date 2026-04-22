package com.podcraft.android.playback

import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.assertFalse

/**
 * Tests for PlaybackService media ID conventions and browse tree logic.
 * These test the mediaId format and parsing without requiring Android framework.
 */
class PlaybackServiceTest {

    @Test
    fun `session mediaId format`() {
        val sessionId = "abc-123"
        val mediaId = "session:$sessionId"
        assertTrue(mediaId.startsWith("session:"))
        assertEquals(sessionId, mediaId.removePrefix("session:"))
    }

    @Test
    fun `segment mediaId format`() {
        val sessionId = "sess-1"
        val segmentId = "seg-5"
        val mediaId = "segment:$sessionId:$segmentId"
        assertTrue(mediaId.startsWith("segment:"))
        val parts = mediaId.removePrefix("segment:").split(":", limit = 2)
        assertEquals(2, parts.size)
        assertEquals(sessionId, parts[0])
        assertEquals(segmentId, parts[1])
    }

    @Test
    fun `play_all mediaId format`() {
        val sessionId = "sess-1"
        val mediaId = "play_all:$sessionId"
        assertTrue(mediaId.startsWith("play_all:"))
        assertEquals(sessionId, mediaId.removePrefix("play_all:"))
    }

    @Test
    fun `root ID constants`() {
        assertEquals("root", PlaybackService.ROOT_ID)
        assertEquals("recent", PlaybackService.RECENT_ID)
        assertEquals("favorites", PlaybackService.FAVORITES_ID)
        assertEquals("all_sessions", PlaybackService.ALL_SESSIONS_ID)
    }

    @Test
    fun `mediaId prefixes are disjoint`() {
        val prefixes = listOf("session:", "segment:", "play_all:", "sign_in_prompt", "empty_")
        for (i in prefixes.indices) {
            for (j in i + 1 until prefixes.size) {
                assertFalse(
                    prefixes[i].startsWith(prefixes[j]) || prefixes[j].startsWith(prefixes[i]),
                    "Prefixes ${prefixes[i]} and ${prefixes[j]} should not overlap"
                )
            }
        }
    }

    @Test
    fun `segment mediaId with colons in segmentId parses correctly`() {
        val sessionId = "sess-1"
        val segmentId = "seg:with:colons"
        val mediaId = "segment:$sessionId:$segmentId"
        val parts = mediaId.removePrefix("segment:").split(":", limit = 2)
        assertEquals(sessionId, parts[0])
        assertEquals(segmentId, parts[1])
    }

    @Test
    fun `category IDs are well-known strings`() {
        val categories = setOf(
            PlaybackService.ROOT_ID,
            PlaybackService.RECENT_ID,
            PlaybackService.FAVORITES_ID,
            PlaybackService.ALL_SESSIONS_ID,
        )
        assertEquals(4, categories.size, "All category IDs must be unique")
        categories.forEach { id ->
            assertFalse(id.contains(":"), "Category IDs should not contain colons: $id")
        }
    }
}
