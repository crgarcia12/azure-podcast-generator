package com.podcraft.android.api

import kotlinx.serialization.json.Json
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Extended API model tests for edge cases and additional model types.
 */
class ModelsEdgeCaseTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `Session deserializes with null summary`() {
        val raw = """{
            "id":"s1","topic":"T","title":"Title",
            "revision":1,"status":"ready",
            "segments":[],"interrupts":[],
            "createdAt":"2025-01-01T00:00:00Z","updatedAt":"2025-01-01T00:00:00Z"
        }"""
        val session = json.decodeFromString(Session.serializer(), raw)
        assertNull(session.summary)
        assertTrue(session.segments.isEmpty())
    }

    @Test
    fun `ChatResponse deserializes with session update`() {
        val raw = """{
            "userMessage":{"id":"m1","sessionId":"s1","role":"user","content":"hello","createdAt":"2025-01-01T00:00:00Z"},
            "assistantMessage":{"id":"m2","sessionId":"s1","role":"assistant","content":"hi","createdAt":"2025-01-01T00:00:00Z"},
            "session":{"id":"s1","topic":"T","title":"Title","revision":2,"status":"ready","segments":[],"interrupts":[],"createdAt":"2025-01-01T00:00:00Z","updatedAt":"2025-01-01T00:00:00Z"}
        }"""
        val resp = json.decodeFromString(ChatResponse.serializer(), raw)
        assertEquals("m1", resp.userMessage?.id)
        assertEquals("m2", resp.assistantMessage?.id)
        assertEquals(2, resp.session?.revision)
    }

    @Test
    fun `ChatResponse deserializes with error`() {
        val raw = """{"error":"Rate limited"}"""
        val resp = json.decodeFromString(ChatResponse.serializer(), raw)
        assertEquals("Rate limited", resp.error)
        assertNull(resp.session)
    }

    @Test
    fun `PodcastResponse deserializes with draftEpisode`() {
        val raw = """{
            "error":"Audio synthesis failed",
            "draftEpisode":{
                "id":"ep-1","topic":"T","title":"Title","summary":"S",
                "createdAt":"2025-01-01T00:00:00Z","transcript":[],"audioAvailable":false
            }
        }"""
        val resp = json.decodeFromString(PodcastResponse.serializer(), raw)
        assertEquals("Audio synthesis failed", resp.error)
        assertEquals("ep-1", resp.draftEpisode?.id)
        assertNull(resp.episode)
    }

    @Test
    fun `SessionSummary with all fields`() {
        val raw = """{
            "id":"s1","topic":"topic","title":"title","segmentCount":5,
            "interruptCount":2,"status":"generating","favorite":true,
            "createdAt":"2025-01-01T00:00:00Z","updatedAt":"2025-01-02T00:00:00Z"
        }"""
        val summary = json.decodeFromString(SessionSummary.serializer(), raw)
        assertEquals("generating", summary.status)
        assertTrue(summary.favorite)
        assertEquals(5, summary.segmentCount)
    }

    @Test
    fun `Segment with all fields including generatedAfterInterrupt`() {
        val raw = """{
            "id":"seg-1","index":3,"hostLine":"Host says","guestLine":"Guest says",
            "status":"active","revision":2,"audioUrl":"/api/audio/seg-1",
            "generatedAfterInterrupt":"int-42"
        }"""
        val seg = json.decodeFromString(Segment.serializer(), raw)
        assertEquals(3, seg.index)
        assertEquals(2, seg.revision)
        assertEquals("int-42", seg.generatedAfterInterrupt)
    }

    @Test
    fun `MessageResponse with both fields`() {
        val raw = """{"message":"OK","role":"admin"}"""
        val resp = json.decodeFromString(MessageResponse.serializer(), raw)
        assertEquals("OK", resp.message)
        assertEquals("admin", resp.role)
    }

    @Test
    fun `MessageResponse with null fields`() {
        val raw = """{}"""
        val resp = json.decodeFromString(MessageResponse.serializer(), raw)
        assertNull(resp.message)
        assertNull(resp.role)
    }
}
