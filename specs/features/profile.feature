@profile
Feature: Profile page, navigation bar, and landing page
  As a user of the PodCraft application
  I want to view my profile, see role-appropriate navigation, and access the landing page
  So that I can manage my account and navigate the app based on my authentication state

  # ──────────────────────────────────────────────
  # Profile Page — View Profile
  # ──────────────────────────────────────────────

  @auth-guard
  Scenario: Authenticated user sees their profile information
    Given I am logged in as a user with username "janedoe" and role "user" created at "2025-01-15T08:30:00.000Z"
    When I visit the "/profile" page
    Then I should see the username "janedoe"
    And I should see a role badge displaying "user"
    And I should see the member since date "January 15, 2025"
    And I should see a "Logout" button

  @auth-guard
  Scenario: Authenticated admin sees their profile information
    Given I am logged in as a user with username "adminuser" and role "admin" created at "2024-06-01T12:00:00.000Z"
    When I visit the "/profile" page
    Then I should see the username "adminuser"
    And I should see a role badge displaying "admin"
    And I should see the member since date "June 1, 2024"
    And I should see a "Logout" button

  # ──────────────────────────────────────────────
  # Profile Page — Auth Guard
  # ──────────────────────────────────────────────

  @auth-guard
  Scenario: Unauthenticated user is redirected to login from profile page
    Given I am not authenticated
    When I visit the "/profile" page
    Then I should be redirected to "/login"

  # ──────────────────────────────────────────────
  # Profile Page — Loading State
  # ──────────────────────────────────────────────

  @auth-guard
  Scenario: Profile page shows loading indicator while fetching data
    Given I am logged in as a user with username "janedoe" and role "user" created at "2025-01-15T08:30:00.000Z"
    And the API response for "/api/auth/me" is delayed
    When I visit the "/profile" page
    Then I should see the text "Loading profile…"
    And I should not see a "Logout" button

  # ──────────────────────────────────────────────
  # Profile Page — Logout
  # ──────────────────────────────────────────────

  @auth-guard
  Scenario: User logs out from the profile page
    Given I am logged in as a user with username "janedoe" and role "user" created at "2025-01-15T08:30:00.000Z"
    And I am on the "/profile" page
    When I click the "Logout" button
    Then the "token" cookie should be cleared
    And I should be redirected to "/login"

  # ──────────────────────────────────────────────
  # Navigation Bar States
  # ──────────────────────────────────────────────

  @navigation
  Scenario: NavBar shows Sign in link for guest users
    Given I am not authenticated
    When I visit the "/" page
    Then the NavBar should display the app name "PodCraft" linking to "/"
    And the NavBar should display a "Sign in" link to "/login"
    And the NavBar should not display a "Profile" link
    And the NavBar should not display a "Sign out" button

  @navigation
  Scenario: NavBar shows Profile and Sign out for authenticated user role
    Given I am logged in as a user with username "janedoe" and role "user" created at "2025-01-15T08:30:00.000Z"
    When I visit the "/" page
    Then the NavBar should display the app name "PodCraft" linking to "/"
    And the NavBar should display a "Profile" link to "/profile"
    And the NavBar should display a "Sign out" button
    And the NavBar should not display a "Sign in" link
    And the NavBar should not display an "Admin" link

  @navigation
  Scenario: NavBar shows Profile, Admin, and Sign out for authenticated admin role
    Given I am logged in as a user with username "adminuser" and role "admin" created at "2024-06-01T12:00:00.000Z"
    When I visit the "/" page
    Then the NavBar should display the app name "PodCraft" linking to "/"
    And the NavBar should display a "Profile" link to "/profile"
    And the NavBar should display an "Admin" link to "/admin"
    And the NavBar should display a "Sign out" button
    And the NavBar should not display a "Sign in" link

  @navigation
  Scenario: NavBar shows only the app name while auth check is in flight
    Given the API response for "/api/auth/me" is delayed
    When I visit the "/" page
    Then the NavBar should display the app name "PodCraft" linking to "/"
    And the NavBar should not display a "Sign in" link
    And the NavBar should not display a "Profile" link

  # ──────────────────────────────────────────────
  # Landing Page
  # ──────────────────────────────────────────────

  @landing
  Scenario: Guest user sees Sign in CTA on the landing page
    Given I am not authenticated
    When I visit the "/" page
    Then I should see the heading "Turn any topic into a podcast episode"
    And I should see the text "PodCraft generates an engaging interview-style script"
    And I should see a "Sign in to start" link to "/login"
    And I should not see a "Open Studio" link

  @landing
  Scenario: Authenticated user sees Open Studio CTA on the landing page
    Given I am logged in as a user with username "janedoe" and role "user" created at "2025-01-15T08:30:00.000Z"
    When I visit the "/" page
    Then I should see the heading "Turn any topic into a podcast episode"
    And I should see the text "PodCraft generates an engaging interview-style script"
    And I should see a "Open Studio" link to "/podcasts"
    And I should not see a "Sign in to start" link

  @landing
  Scenario: Landing page shows heading and description but no CTAs while loading
    Given the API response for "/api/auth/me" is delayed
    When I visit the "/" page
    Then I should see the heading "Turn any topic into a podcast episode"
    And I should see the text "PodCraft generates an engaging interview-style script"
    And I should not see a "Sign in to start" link
    And I should not see a "Open Studio" link

  # ──────────────────────────────────────────────
  # Edge Cases
  # ──────────────────────────────────────────────

  @auth-guard @profile
  Scenario: Expired JWT is treated as unauthenticated on the profile page
    Given I have an expired JWT token
    When I visit the "/profile" page
    Then I should be redirected to "/login"

  @auth-guard @profile
  Scenario: Malformed JWT is treated as unauthenticated on the profile page
    Given I have a malformed JWT token
    When I visit the "/profile" page
    Then I should be redirected to "/login"

  @auth-guard @profile
  Scenario: Deleted user with valid JWT is treated as unauthenticated
    Given I have a valid JWT token for a deleted user
    When I visit the "/profile" page
    Then I should be redirected to "/login"

  @auth-guard @profile
  Scenario: API unreachable shows error state with retry on the profile page
    Given I am logged in as a user with username "janedoe" and role "user" created at "2025-01-15T08:30:00.000Z"
    And the API at "/api/auth/me" is unreachable
    When I visit the "/profile" page
    Then I should see the text "Failed to load profile."
    And I should see a "Retry" button

  @navigation @profile
  Scenario: NavBar falls back to guest state when API is unreachable
    Given the API at "/api/auth/me" is unreachable
    When I visit the "/" page
    Then the NavBar should display a "Sign in" link to "/login"
    And the NavBar should not display a "Profile" link
