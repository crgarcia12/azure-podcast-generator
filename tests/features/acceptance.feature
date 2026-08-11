Feature: Natural and responsive podcast listening

  Scenario: Default controls are visible and submitted
    Given I am signed in
    And the podcast provider is configured as "mock"
    When I open "/podcasts"
    Then the "Audience level" control is set to "Intermediate"
    And the "Episode length" control is set to "10 minutes"
    And the "Conversation style" control is set to "Conversational"
    When I enter "History of Boeing" as the topic
    And I select "Generate episode"
    Then the generation request contains audience "Intermediate"
    And the generation request contains duration 10 minutes
    And the generation request contains style "Conversational"

  Scenario: Generated transcript satisfies conversation constraints
    Given I am signed in
    And the podcast provider is configured as "mock"
    When I generate "History of Boeing" for a "Beginner" audience
    And I select an episode length of "5 minutes"
    And I select the "Conversational" style
    Then the transcript contains at least one "host" turn
    And the transcript contains at least one "guest" turn
    And every transcript turn contains non-whitespace text
    And every transcript turn contains at most 80 words
    And the estimated transcript duration is between 4 and 6 minutes

  Scenario: Playback starts before complete synthesis
    Given I am signed in
    And the podcast provider is configured as "mock"
    When I generate a podcast about "History of Boeing"
    Then I see the status "Generating script"
    And I later see the status "Preparing audio"
    When audio segment 1 becomes ready
    Then the podcast playback control is enabled
    And at least one later audio segment is still being prepared

  Scenario: A question is acknowledged and answered promptly
    Given I am signed in
    And a mock-provider episode about "History of Boeing" is playing
    When I submit the text question "Why did jet engines matter?"
    Then episode playback is paused immediately
    And the status "Question received" is announced within 3 seconds
    And the status "Answering question" is announced
    And intervention answer playback begins within 8 seconds

  Scenario: Episode resumes at the interruption position
    Given I am signed in
    And a podcast episode was interrupted at 42 seconds
    And the intervention answer is playing
    When the intervention answer finishes
    Then the original episode resumes within 2 seconds
    And the resumed episode position is between 40 and 44 seconds

  Scenario: Failed intervention can be retried or skipped
    Given I am signed in
    And a mock-provider episode is paused at 42 seconds
    And intervention generation is configured to fail
    When I submit the text question "Why did jet engines matter?"
    Then I see an actionable intervention error
    And I see a "Retry" action
    And I see a "Resume episode" action
    When I select "Resume episode"
    Then the existing episode resumes between 40 and 44 seconds
    And no new episode generation request is sent

  Scenario: Controls and intervention states are accessible
    Given I am signed in
    And I am using only the keyboard
    When I open "/podcasts"
    Then I can focus and operate "Audience level"
    And I can focus and operate "Episode length"
    And I can focus and operate "Conversation style"
    And I can focus and operate "Ask a question"
    And applicable actions named "Cancel", "Retry", and "Resume episode" are keyboard operable
    When an intervention progresses through received, answering, failed, cancelled, and resumed states
    Then each state is announced by an accessible live region

  Scenario: Telemetry contains only privacy-safe podcast metadata
    Given podcast telemetry is captured by the test telemetry sink
    When I generate "History of Boeing"
    And I submit the question "Why did jet engines matter?"
    Then telemetry includes stage name, duration, provider type, success status, and correlation identifier
    And failed stages include a non-sensitive error code
    And telemetry does not contain "History of Boeing"
    And telemetry does not contain "Why did jet engines matter?"
    And telemetry contains no transcript text, credentials, tokens, or audio payloads
