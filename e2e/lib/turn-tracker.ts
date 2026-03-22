/**
 * Turn Tracker for E2E Tests
 *
 * Records every turn in a conversation, tracks timing,
 * and provides assertion helpers for test verification.
 */

// ==============================================
// TYPES
// ==============================================

export interface TrackedTurn {
  turnNumber: number
  role: 'user' | 'assistant'
  content: string
  toolsCalled: string[]
  uiActionTypes: string[]
  durationMs: number
}

interface TurnSummary {
  totalTurns: number
  toolsUsed: string[]
  durationMs: number
}

// ==============================================
// TURN TRACKER
// ==============================================

export class TurnTracker {
  private turns: TrackedTurn[] = []
  private errors: string[] = []

  /**
   * Record a completed turn.
   */
  addTurn(turn: TrackedTurn): void {
    this.turns.push(turn)
  }

  /**
   * Record an error encountered during the conversation.
   */
  addError(error: string): void {
    this.errors.push(error)
  }

  /**
   * Get all recorded turns.
   */
  getTurns(): ReadonlyArray<TrackedTurn> {
    return this.turns
  }

  /**
   * Get the last recorded turn, or undefined if none.
   */
  getLastTurn(): TrackedTurn | undefined {
    return this.turns[this.turns.length - 1]
  }

  /**
   * Assert that a specific tool was called at least once across all turns.
   * Throws if the tool was never called.
   */
  assertToolCalled(toolName: string): void {
    const allTools = this.getToolsCalled()
    if (!allTools.includes(toolName)) {
      throw new Error(
        `Expected tool "${toolName}" to be called, but it was not. ` +
          `Tools called: [${allTools.join(', ')}]`,
      )
    }
  }

  /**
   * Assert that no errors were recorded during the conversation.
   */
  assertNoErrors(): void {
    if (this.errors.length > 0) {
      throw new Error(
        `Expected no errors, but found ${this.errors.length}: ` +
          this.errors.join('; '),
      )
    }
  }

  /**
   * Assert that the total turn count is within [min, max] (inclusive).
   */
  assertTurnCount(min: number, max: number): void {
    const count = this.turns.length
    if (count < min || count > max) {
      throw new Error(
        `Expected turn count between ${min} and ${max}, but got ${count}`,
      )
    }
  }

  /**
   * Get unique tool names called across all turns.
   */
  getToolsCalled(): string[] {
    const toolSet = new Set<string>()
    for (const turn of this.turns) {
      for (const tool of turn.toolsCalled) {
        toolSet.add(tool)
      }
    }
    return Array.from(toolSet)
  }

  /**
   * Get all recorded errors.
   */
  getErrors(): ReadonlyArray<string> {
    return this.errors
  }

  /**
   * Get a summary of the conversation for reporting.
   */
  getSummary(): TurnSummary {
    const totalDuration = this.turns.reduce(
      (sum, t) => sum + t.durationMs,
      0,
    )

    return {
      totalTurns: this.turns.length,
      toolsUsed: this.getToolsCalled(),
      durationMs: totalDuration,
    }
  }
}
