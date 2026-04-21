package com.podcraft.android.api

import kotlinx.serialization.json.Json
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.test.assertFalse

class ModelsTest {

    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `LoginRequest serializes correctly`() {
        val req = LoginRequest("testuser", "password123")
        val encoded = json.encodeToString(LoginRequest.serializer(), req)
        assertTrue(encoded.contains("\"username\":\"testuser\""))
        assertTrue(encoded.contains("\"password\":\"password123\""))
    }

    @Test
    fun `RegisterRequest serializes correctly`() {
        val req = RegisterRequest("newuser", "securepass")
        val encoded = json.encodeToString(RegisterRequest.serializer(), req)
        assertTrue(encoded.contains("\"username\":\"newuser\""))
        assertTrue(encoded.contains("\"password\":\"securepass\""))
    }

    @Test
    fun `AuthUser deserializes correctly`() {
        val raw = """{"username":"admin","role":"admin","createdAt":"2025-01-01T00:00:00.000Z"}"""
        val user = json.decodeFromString(AuthUser.serializer(), raw)
        assertEquals("admin", user.username)
        assertEquals("admin", user.role)
        assertEquals("2025-01-01T00:00:00.000Z", user.createdAt)
    }

    @Test
    fun `RegistrationStatusResponse deserializes correctly`() {
        val enabled = json.decodeFromString(RegistrationStatusResponse.serializer(), """{"enabled":true}""")
        assertTrue(enabled.enabled)

        val disabled = json.decodeFromString(RegistrationStatusResponse.serializer(), """{"enabled":false}""")
        assertFalse(disabled.enabled)
    }

    @Test
    fun `SessionSummary deserializes correctly`() {
        val raw = """{
            "id":"sess-1","topic":"AI","title":"AI Podcast","segmentCount":3,
            "interruptCount":1,"status":"ready","createdAt":"2025-06-01T00:00:00Z",
            "updatedAt":"2025-06-01T01:00:00Z"
        }"""
        val summary = json.decodeFromString(SessionSummary.serializer(), raw)
        assertEquals("sess-1", summary.id)
        assertEquals("AI", summary.topic)
        assertEquals(3, summary.segmentCount)
        assertEquals(1, summary.interruptCount)
    }

    @Test
    fun `Segment deserializes with optional generatedAfterInterrupt`() {
        val withInterrupt = """{
            "id":"seg-1","index":0,"hostLine":"Hello","guestLine":"Hi",
            "status":"active","revision":1,"audioUrl":"/api/audio/seg-1",
            "generatedAfterInterrupt":"int-1"
        }"""
        val seg = json.decodeFromString(Segment.serializer(), withInterrupt)
        assertEquals("int-1", seg.generatedAfterInterrupt)

        val withoutInterrupt = """{
            "id":"seg-2","index":1,"hostLine":"Next","guestLine":"Sure",
            "status":"active","revision":1,"audioUrl":"/api/audio/seg-2"
        }"""
        val seg2 = json.decodeFromString(Segment.serializer(), withoutInterrupt)
        assertNull(seg2.generatedAfterInterrupt)
    }

    @Test
    fun `Session deserializes with segments and interrupts`() {
        val raw = """{
            "id":"sess-1","topic":"Tech","title":"Tech Talk","summary":"A tech podcast",
            "revision":2,"status":"ready",
            "segments":[{"id":"s1","index":0,"hostLine":"h","guestLine":"g","status":"active","revision":1,"audioUrl":"/a"}],
            "interrupts":[{"id":"i1","afterSegmentId":"s1","questionText":"Why?","inputMethod":"text","createdAt":"2025-06-01T00:00:00Z"}],
            "createdAt":"2025-06-01T00:00:00Z","updatedAt":"2025-06-01T01:00:00Z"
        }"""
        val session = json.decodeFromString(Session.serializer(), raw)
        assertEquals(1, session.segments.size)
        assertEquals(1, session.interrupts.size)
        assertEquals("Why?", session.interrupts[0].questionText)
    }

    @Test
    fun `SessionListResponse deserializes empty list`() {
        val raw = """{"sessions":[]}"""
        val resp = json.decodeFromString(SessionListResponse.serializer(), raw)
        assertTrue(resp.sessions.isEmpty())
    }

    @Test
    fun `PodcastEpisode deserializes correctly`() {
        val raw = """{
            "id":"ep-1","topic":"History","title":"History 101","summary":"About history",
            "createdAt":"2025-06-01T00:00:00Z",
            "transcript":[{"id":"t1","speaker":"host","speakerLabel":"Host","text":"Welcome"}],
            "audioAvailable":true,"audioUrl":"/api/podcasts/ep-1/audio","audioContentType":"audio/wav"
        }"""
        val ep = json.decodeFromString(PodcastEpisode.serializer(), raw)
        assertEquals("ep-1", ep.id)
        assertTrue(ep.audioAvailable)
        assertEquals(1, ep.transcript.size)
        assertEquals("host", ep.transcript[0].speaker)
    }

    @Test
    fun `PodcastEpisode deserializes without audio`() {
        val raw = """{
            "id":"ep-2","topic":"Science","title":"Science 101","summary":"About science",
            "createdAt":"2025-06-01T00:00:00Z","transcript":[],"audioAvailable":false
        }"""
        val ep = json.decodeFromString(PodcastEpisode.serializer(), raw)
        assertFalse(ep.audioAvailable)
        assertNull(ep.audioUrl)
        assertNull(ep.audioContentType)
    }

    @Test
    fun `CreatePodcastRequest serializes correctly`() {
        val req = CreatePodcastRequest("Quantum Computing")
        val encoded = json.encodeToString(CreatePodcastRequest.serializer(), req)
        assertTrue(encoded.contains("\"topic\":\"Quantum Computing\""))
    }

    @Test
    fun `CreateSessionRequest serializes correctly`() {
        val req = CreateSessionRequest("Machine Learning")
        val encoded = json.encodeToString(CreateSessionRequest.serializer(), req)
        assertTrue(encoded.contains("\"topic\":\"Machine Learning\""))
    }

    @Test
    fun `ErrorResponse deserializes correctly`() {
        val raw = """{"error":"Something went wrong"}"""
        val err = json.decodeFromString(ErrorResponse.serializer(), raw)
        assertEquals("Something went wrong", err.error)
    }

    @Test
    fun `LoginResponse deserializes with unknown fields ignored`() {
        val raw = """{"message":"Login successful","someNewField":true}"""
        val resp = json.decodeFromString(LoginResponse.serializer(), raw)
        assertEquals("Login successful", resp.message)
    }

    @Test
    fun `AdminUser deserializes correctly`() {
        val raw = """{"username":"admin","role":"admin","createdAt":"2025-01-01T00:00:00.000Z"}"""
        val user = json.decodeFromString(AdminUser.serializer(), raw)
        assertEquals("admin", user.username)
        assertEquals("admin", user.role)
    }
}
