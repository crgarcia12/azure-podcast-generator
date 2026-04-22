package com.podcraft.android.ui.sessions

import org.junit.Test
import kotlin.test.assertEquals

/**
 * Tests for session status badge display logic and date formatting.
 */
class SessionDisplayTest {

    @Test
    fun `status label for ready`() {
        assertEquals("Ready", statusLabel("ready"))
    }

    @Test
    fun `status label for generating`() {
        assertEquals("Generating", statusLabel("generating"))
    }

    @Test
    fun `status label for error`() {
        assertEquals("Error", statusLabel("error"))
    }

    @Test
    fun `status label for unknown defaults to Ready`() {
        assertEquals("Ready", statusLabel("completed"))
        assertEquals("Ready", statusLabel(""))
    }

    @Test
    fun `formatDate extracts date from ISO string`() {
        assertEquals("2025-06-01", formatDateString("2025-06-01T12:30:45.000Z"))
    }

    @Test
    fun `formatDate handles date-only string`() {
        assertEquals("2025-06-01", formatDateString("2025-06-01"))
    }

    @Test
    fun `formatDate handles empty string`() {
        assertEquals("", formatDateString(""))
    }

    // Helper functions that mirror the logic in the Composable
    private fun statusLabel(status: String): String = when (status) {
        "generating" -> "Generating"
        "error" -> "Error"
        else -> "Ready"
    }

    private fun formatDateString(iso: String): String {
        return try {
            iso.substringBefore("T")
        } catch (_: Exception) {
            iso
        }
    }
}
