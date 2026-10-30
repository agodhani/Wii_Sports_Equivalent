export type MatchPhase = 'menu' | 'calibration' | 'serving' | 'rally' | 'point' | 'gameover';
export type Winner = 'player' | 'cpu';

export const WIN_SCORE = 7;

export class Match {
  phase: MatchPhase = 'menu';
  playerScore = 0;
  cpuScore = 0;
  winner: Winner | null = null;

  private expect(phase: MatchPhase, action: string): void {
    if (this.phase !== phase) throw new Error(`${action} called in phase ${this.phase}`);
  }

  start(): void {
    this.expect('menu', 'start');
    this.phase = 'calibration';
  }

  calibrated(): void {
    this.expect('calibration', 'calibrated');
    this.phase = 'serving';
  }

  serveLaunched(): void {
    this.expect('serving', 'serveLaunched');
    this.phase = 'rally';
  }

  pointTo(w: Winner): void {
    this.expect('rally', 'pointTo');
    if (w === 'player') this.playerScore++; else this.cpuScore++;
    if (this.playerScore >= WIN_SCORE || this.cpuScore >= WIN_SCORE) {
      this.winner = w;
      this.phase = 'gameover';
    } else {
      this.phase = 'point';
    }
  }

  nextPoint(): void {
    this.expect('point', 'nextPoint');
    this.phase = 'serving';
  }

  reset(): void {
    this.phase = 'menu';
    this.playerScore = 0;
    this.cpuScore = 0;
    this.winner = null;
  }
}
