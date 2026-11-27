export type MatchPhase = 'menu' | 'calibration' | 'serving' | 'rally' | 'point' | 'gameover';
export type Winner = 'player' | 'cpu';

export type ServiceSide = 'deuce' | 'ad';

const POINTS = [0, 15, 30, 40];
const other = (w: Winner): Winner => w === 'player' ? 'cpu' : 'player';

export class Match {
  phase: MatchPhase = 'menu';
  playerScore = 0;
  cpuScore = 0;
  playerGames = 0;
  cpuGames = 0;
  serveAttempt: 1 | 2 = 1;
  winner: Winner | null = null;

  get tiebreak(): boolean {
    return this.playerGames === 6 && this.cpuGames === 6;
  }

  get server(): Winner {
    const gameServer = (this.playerGames + this.cpuGames) % 2 === 0 ? 'cpu' : 'player';
    const points = this.playerScore + this.cpuScore;
    return this.tiebreak && Math.floor((points + 1) / 2) % 2 ? other(gameServer) : gameServer;
  }

  get serviceSide(): ServiceSide {
    return (this.playerScore + this.cpuScore) % 2 === 0 ? 'deuce' : 'ad';
  }

  get pointLabel(): string {
    const { playerScore: you, cpuScore: cpu } = this;
    if (this.tiebreak) return `${you} — ${cpu}`;
    if (you >= 3 && cpu >= 3) {
      return you === cpu ? 'Deuce' : you > cpu ? 'Adv You' : 'Adv CPU';
    }
    return `${POINTS[you]} — ${POINTS[cpu]}`;
  }

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

  serveIn(): void {
    this.expect('serving', 'serveIn');
    this.phase = 'rally';
  }

  serveFault(): 'fault' | 'double-fault' {
    this.expect('serving', 'serveFault');
    if (this.serveAttempt === 1) {
      this.serveAttempt = 2;
      return 'fault';
    }
    this.scorePoint(other(this.server));
    return 'double-fault';
  }

  pointTo(w: Winner): void {
    this.expect('rally', 'pointTo');
    this.scorePoint(w);
  }

  private scorePoint(w: Winner): void {
    const tiebreak = this.tiebreak;
    if (w === 'player') this.playerScore++; else this.cpuScore++;
    this.serveAttempt = 1;
    const points = Math.max(this.playerScore, this.cpuScore);
    const margin = Math.abs(this.playerScore - this.cpuScore);
    if (points >= (tiebreak ? 7 : 4) && margin >= 2) {
      if (w === 'player') this.playerGames++; else this.cpuGames++;
      this.playerScore = this.cpuScore = 0;
      const games = Math.max(this.playerGames, this.cpuGames);
      if (tiebreak || (games >= 6 && Math.abs(this.playerGames - this.cpuGames) >= 2)) {
        this.winner = w;
        this.phase = 'gameover';
        return;
      }
    }
    this.phase = 'point';
  }

  nextPoint(): void {
    this.expect('point', 'nextPoint');
    this.phase = 'serving';
  }

  reset(): void {
    this.phase = 'menu';
    this.playerScore = 0;
    this.cpuScore = 0;
    this.playerGames = 0;
    this.cpuGames = 0;
    this.serveAttempt = 1;
    this.winner = null;
  }
}
