Feature: Continuous hour-long podcast generation

  Scenario: Generate an initial multi-exchange batch
    Given I am signed in and viewing "/podcasts"
    When I start a podcast about "History of Boeing" with a target duration of 60 minutes
    Then batch 1 contains at least 5 ordered host-question and guest-answer exchanges
    And batch 1 has playable audio
    And the generated-duration progress is greater than 0 minutes

  Scenario: Continue generation until the duration target is reached
    Given a podcast about "History of Boeing" is generating with a target duration of 60 minutes
    When all required batches have completed
    Then the estimated generated duration is at least 60 minutes
    And the episode state is "complete"
    And no provider call is made after completion

  Scenario: Prevent repeated questions across provider calls
    Given batch 1 has completed for the topic "History of Boeing"
    When batch 2 is requested
    Then the provider request includes the questions covered by batch 1 or a summary containing them
    And no normalized host question in batch 2 matches a host question in batch 1

  Scenario: Play generated audio continuously
    Given batch 1 is playable and batch 2 is still generating
    When I start playback
    Then playback begins with batch 1
    When batch 1 finishes after batch 2 becomes playable
    Then playback automatically continues with batch 2 without user interaction

  Scenario: Append transcript content in playback order
    Given the transcript displays all exchanges from batch 1
    When batch 2 completes
    Then the transcript still displays every exchange from batch 1
    And all batch 2 exchanges appear after the batch 1 exchanges

  Scenario: Resume the episode after a listener question
    Given the original episode is playing batch 2 at 30 seconds
    When I ask "How did the 737 influence commercial aviation?"
    Then the episode playback pauses
    And an answer to "How did the 737 influence commercial aviation?" is played
    And the original episode resumes from batch 2 at 30 seconds

  Scenario: Retry a failed batch without regenerating completed batches
    Given batches 1 and 2 have completed
    And generation of batch 3 has failed
    When I retry generation
    Then generation resumes at batch 3
    And batches 1 and 2 retain their original identifiers, transcripts, and audio
    And the provider is not called again for batch 1 or batch 2

  Scenario: Complete generation with the mock provider
    Given Azure podcast settings are absent
    And the mock provider is active
    When I generate a 60-minute podcast about "History of Boeing"
    Then the estimated generated duration reaches at least 60 minutes
    And repeated runs produce the same ordered batches
    And no normalized host question is repeated

  Scenario: Enforce explicit generation termination
    Given a podcast is actively generating
    When I stop generation
    Then no additional batch is requested
    And the episode state is "stopped"
    Given another podcast has made 30 provider calls without reaching 60 minutes
    When another batch would be required
    Then no additional provider call is made
    And the episode displays a "generation limit reached" state
