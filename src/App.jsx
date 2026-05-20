import { useEffect, useMemo, useState } from "react";
import "./App.css";

const STORAGE_KEY = "pickleball_tournament_v1";

function shuffleArray(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getStageLabel(stage) {
  const labels = {
    GROUP: "Group Stage",
    SEMIFINAL: "Semifinal",
    FINAL: "Final",
    KNOCKOUT: "Knockout",
  };

  return labels[stage] || stage;
}

function getRoundName(roundIndex, totalTeamsAtStart) {
  if (totalTeamsAtStart <= 2) return "Final";

  const estimatedRemaining = totalTeamsAtStart / Math.pow(2, roundIndex);

  if (estimatedRemaining <= 2) return "Final";
  if (estimatedRemaining <= 4) return "Semifinal";
  if (estimatedRemaining <= 8) return "Quarterfinal";
  if (estimatedRemaining <= 16) return "Round of 16";

  return `Round ${roundIndex + 1}`;
}

function nextPowerOfTwo(number) {
  let power = 1;
  while (power < number) power *= 2;
  return power;
}

function createTeams(players) {
  const shuffled = shuffleArray(players);
  const teams = [];

  for (let i = 0; i < shuffled.length; i += 2) {
    teams.push({
      id: makeId("team"),
      name: `Team ${teams.length + 1}`,
      players: [shuffled[i], shuffled[i + 1]],
    });
  }

  return teams;
}

function createRoundRobinMatches(groupName, teams) {
  const matches = [];

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      matches.push({
        id: makeId("match"),
        day: "Day 1",
        stage: "GROUP",
        groupName,
        roundIndex: 0,
        team1Id: teams[i].id,
        team2Id: teams[j].id,
        score1: "",
        score2: "",
        winnerId: null,
        isComplete: false,
      });
    }
  }

  return matches;
}

function createGroupTournament(teams) {
  const groupASize = Math.ceil(teams.length / 2);
  const groupA = teams.slice(0, groupASize);
  const groupB = teams.slice(groupASize);

  const groups = [
    { name: "Group A", teamIds: groupA.map((team) => team.id) },
    { name: "Group B", teamIds: groupB.map((team) => team.id) },
  ];

  const matches = [
    ...createRoundRobinMatches("Group A", groupA),
    ...createRoundRobinMatches("Group B", groupB),
  ];

  return { groups, matches };
}

function createKnockoutFirstRound(teams) {
  const shuffledTeams = shuffleArray(teams);
  const bracketSize = nextPowerOfTwo(shuffledTeams.length);
  const slots = [...shuffledTeams];

  while (slots.length < bracketSize) {
    slots.push(null);
  }

  const matches = [];

  for (let i = 0; i < slots.length; i += 2) {
    const team1 = slots[i];
    const team2 = slots[i + 1];

    const hasBye = team1 && !team2;

    matches.push({
      id: makeId("match"),
      day: "Day 1",
      stage: "KNOCKOUT",
      groupName: null,
      roundIndex: 0,
      roundName: getRoundName(0, bracketSize),
      team1Id: team1?.id || null,
      team2Id: team2?.id || null,
      score1: "",
      score2: "",
      winnerId: hasBye ? team1.id : null,
      isComplete: Boolean(hasBye),
      isBye: Boolean(hasBye),
    });
  }

  return matches;
}

function getTeamName(teams, teamId) {
  if (!teamId) return "TBD";
  const team = teams.find((item) => item.id === teamId);
  if (!team) return "TBD";
  return `${team.name}: ${team.players.join(" + ")}`;
}

function calculateWinner(match) {
  const s1 = Number(match.score1);
  const s2 = Number(match.score2);

  if (Number.isNaN(s1) || Number.isNaN(s2)) return null;
  if (s1 === s2) return null;
  if (!match.team1Id || !match.team2Id) return null;

  return s1 > s2 ? match.team1Id : match.team2Id;
}

function calculateStandings(group, teams, matches) {
  const groupTeamIds = group.teamIds;

  const standings = groupTeamIds.map((teamId) => ({
    teamId,
    played: 0,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointDifference: 0,
  }));

  const groupMatches = matches.filter(
    (match) =>
      match.stage === "GROUP" &&
      match.groupName === group.name &&
      match.isComplete
  );

  groupMatches.forEach((match) => {
    const team1Standing = standings.find((row) => row.teamId === match.team1Id);
    const team2Standing = standings.find((row) => row.teamId === match.team2Id);

    const score1 = Number(match.score1);
    const score2 = Number(match.score2);

    if (!team1Standing || !team2Standing) return;

    team1Standing.played += 1;
    team2Standing.played += 1;

    team1Standing.pointsFor += score1;
    team1Standing.pointsAgainst += score2;

    team2Standing.pointsFor += score2;
    team2Standing.pointsAgainst += score1;

    if (match.winnerId === match.team1Id) {
      team1Standing.wins += 1;
      team2Standing.losses += 1;
    } else if (match.winnerId === match.team2Id) {
      team2Standing.wins += 1;
      team1Standing.losses += 1;
    }
  });

  standings.forEach((row) => {
    row.pointDifference = row.pointsFor - row.pointsAgainst;
  });

  return standings.sort((a, b) => {
    if (b.wins !== a.wins) return b.wins - a.wins;

    const tiedRows = standings.filter((row) => row.wins === a.wins);

    if (tiedRows.length === 2) {
      const headToHead = groupMatches.find(
        (match) =>
          [match.team1Id, match.team2Id].includes(a.teamId) &&
          [match.team1Id, match.team2Id].includes(b.teamId)
      );

      if (headToHead?.winnerId === a.teamId) return -1;
      if (headToHead?.winnerId === b.teamId) return 1;
    }

    if (b.pointDifference !== a.pointDifference) {
      return b.pointDifference - a.pointDifference;
    }

    if (b.pointsFor !== a.pointsFor) {
      return b.pointsFor - a.pointsFor;
    }

    return getTeamName(teams, a.teamId).localeCompare(getTeamName(teams, b.teamId));
  });
}

function areGroupMatchesComplete(matches) {
  const groupMatches = matches.filter((match) => match.stage === "GROUP");
  return groupMatches.length > 0 && groupMatches.every((match) => match.isComplete);
}

function createGroupPlayoffs(groups, teams, matches) {
  const hasSemifinals = matches.some((match) => match.stage === "SEMIFINAL");
  if (hasSemifinals) return matches;

  if (!areGroupMatchesComplete(matches)) return matches;

  if (groups.length < 2) return matches;

  const groupAStandings = calculateStandings(groups[0], teams, matches);
  const groupBStandings = calculateStandings(groups[1], teams, matches);

  if (groupAStandings.length < 2 || groupBStandings.length < 2) {
    return matches;
  }

  const semiFinals = [
    {
      id: makeId("match"),
      day: "Day 2",
      stage: "SEMIFINAL",
      groupName: null,
      roundIndex: 1,
      team1Id: groupAStandings[0].teamId,
      team2Id: groupBStandings[1].teamId,
      score1: "",
      score2: "",
      winnerId: null,
      isComplete: false,
    },
    {
      id: makeId("match"),
      day: "Day 2",
      stage: "SEMIFINAL",
      groupName: null,
      roundIndex: 1,
      team1Id: groupBStandings[0].teamId,
      team2Id: groupAStandings[1].teamId,
      score1: "",
      score2: "",
      winnerId: null,
      isComplete: false,
    },
  ];

  return [...matches, ...semiFinals];
}

function createGroupFinalIfReady(matches) {
  const hasFinal = matches.some((match) => match.stage === "FINAL");
  if (hasFinal) return matches;

  const semifinals = matches.filter((match) => match.stage === "SEMIFINAL");

  if (semifinals.length !== 2) return matches;
  if (!semifinals.every((match) => match.isComplete && match.winnerId)) return matches;

  const finalMatch = {
    id: makeId("match"),
    day: "Day 2",
    stage: "FINAL",
    groupName: null,
    roundIndex: 2,
    team1Id: semifinals[0].winnerId,
    team2Id: semifinals[1].winnerId,
    score1: "",
    score2: "",
    winnerId: null,
    isComplete: false,
  };

  return [...matches, finalMatch];
}

function createNextKnockoutRoundIfReady(matches, initialTeamCount) {
  const knockoutMatches = matches.filter((match) => match.stage === "KNOCKOUT");

  if (knockoutMatches.length === 0) return matches;

  const maxRound = Math.max(...knockoutMatches.map((match) => match.roundIndex));
  const currentRoundMatches = knockoutMatches.filter(
    (match) => match.roundIndex === maxRound
  );

  const alreadyHasNextRound = knockoutMatches.some(
    (match) => match.roundIndex === maxRound + 1
  );

  if (alreadyHasNextRound) return matches;
  if (!currentRoundMatches.every((match) => match.isComplete && match.winnerId)) {
    return matches;
  }

  if (currentRoundMatches.length === 1) return matches;

  const winners = currentRoundMatches.map((match) => ({
    id: match.winnerId,
  }));

  const nextRound = [];
  const bracketSize = nextPowerOfTwo(initialTeamCount);

  for (let i = 0; i < winners.length; i += 2) {
    const team1 = winners[i];
    const team2 = winners[i + 1];

    nextRound.push({
      id: makeId("match"),
      day: maxRound + 1 >= 1 ? "Day 2" : "Day 1",
      stage: "KNOCKOUT",
      groupName: null,
      roundIndex: maxRound + 1,
      roundName: getRoundName(maxRound + 1, bracketSize),
      team1Id: team1?.id || null,
      team2Id: team2?.id || null,
      score1: "",
      score2: "",
      winnerId: null,
      isComplete: false,
      isBye: false,
    });
  }

  return [...matches, ...nextRound];
}

function App() {
  const [tournament, setTournament] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : null;
  });

  const [setup, setSetup] = useState({
    name: "Saturday Pickleball",
    format: "GROUP_STAGE_KNOCKOUT",
    playersText: "",
    matchPoint: 11,
  });

  useEffect(() => {
    if (tournament) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(tournament));
    }
  }, [tournament]);

  const teams = tournament?.teams || [];
  const matches = tournament?.matches || [];
  const groups = tournament?.groups || [];

  const winner = useMemo(() => {
    if (!tournament) return null;

    if (tournament.format === "GROUP_STAGE_KNOCKOUT") {
      const finalMatch = matches.find((match) => match.stage === "FINAL");
      return finalMatch?.winnerId ? getTeamName(teams, finalMatch.winnerId) : null;
    }

    const knockoutMatches = matches.filter((match) => match.stage === "KNOCKOUT");
    if (knockoutMatches.length === 0) return null;

    const maxRound = Math.max(...knockoutMatches.map((match) => match.roundIndex));
    const finalRound = knockoutMatches.filter((match) => match.roundIndex === maxRound);

    if (finalRound.length === 1 && finalRound[0].isComplete && finalRound[0].winnerId) {
      return getTeamName(teams, finalRound[0].winnerId);
    }

    return null;
  }, [matches, teams, tournament]);

  function handleCreateTournament(event) {
    event.preventDefault();

    const players = setup.playersText
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean);

    if (players.length < 4) {
      alert("Add at least 4 players.");
      return;
    }

    if (players.length % 2 !== 0) {
      alert("Doubles tournament needs an even number of players.");
      return;
    }

    const generatedTeams = createTeams(players);

    let generatedGroups = [];
    let generatedMatches = [];

    if (setup.format === "GROUP_STAGE_KNOCKOUT") {
      const result = createGroupTournament(generatedTeams);
      generatedGroups = result.groups;
      generatedMatches = result.matches;
    } else {
      generatedMatches = createKnockoutFirstRound(generatedTeams);
    }

    setTournament({
      id: makeId("tournament"),
      name: setup.name || "Pickleball Tournament",
      format: setup.format,
      matchPoint: setup.matchPoint,
      players,
      teams: generatedTeams,
      groups: generatedGroups,
      matches: generatedMatches,
      createdAt: new Date().toISOString(),
    });
  }

  function updateMatchScore(matchId, field, value) {
    setTournament((current) => {
      const updatedMatches = current.matches.map((match) => {
        if (match.id !== matchId) return match;

        const updatedMatch = {
          ...match,
          [field]: value,
        };

        const winnerId = calculateWinner(updatedMatch);

        return {
          ...updatedMatch,
          winnerId,
          isComplete: Boolean(winnerId),
        };
      });

      let finalMatches = updatedMatches;

      if (current.format === "GROUP_STAGE_KNOCKOUT") {
        finalMatches = createGroupPlayoffs(current.groups, current.teams, finalMatches);
        finalMatches = createGroupFinalIfReady(finalMatches);
      } else {
        finalMatches = createNextKnockoutRoundIfReady(
          finalMatches,
          current.teams.length
        );
      }

      return {
        ...current,
        matches: finalMatches,
      };
    });
  }

  function resetTournament() {
    const confirmed = window.confirm("Reset tournament? This will delete saved data.");
    if (!confirmed) return;

    localStorage.removeItem(STORAGE_KEY);
    setTournament(null);
  }

  function exportTournament() {
    if (!tournament) return;

    const file = new Blob([JSON.stringify(tournament, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${tournament.name.replaceAll(" ", "_")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importTournament(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        setTournament(imported);
      } catch {
        alert("Invalid tournament file.");
      }
    };

    reader.readAsText(file);
  }

  if (!tournament) {
    return (
      <main className="page">
        <section className="card hero-card">
          <p className="eyebrow">Pickleball Utility</p>
          <h1>Tournament Generator</h1>
          <p className="muted">
            Create doubles teams, generate group-stage or knockout schedules,
            enter scores, and continue later from the same browser.
          </p>
        </section>

        <section className="card">
          <h2>Create Tournament</h2>

          <form onSubmit={handleCreateTournament} className="setup-form">
            <label>
              Tournament Name
              <input
                value={setup.name}
                onChange={(event) =>
                  setSetup({ ...setup, name: event.target.value })
                }
                placeholder="Saturday Pickleball"
              />
            </label>

            <label>
              Tournament Format
              <select
                value={setup.format}
                onChange={(event) =>
                  setSetup({ ...setup, format: event.target.value })
                }
              >
                <option value="GROUP_STAGE_KNOCKOUT">
                  Group Stage + Knockout
                </option>
                <option value="DIRECT_KNOCKOUT">Direct Knockout</option>
              </select>
            </label>

            <label>
              Match Point
              <select
                value={setup.matchPoint}
                onChange={(event) =>
                  setSetup({ ...setup, matchPoint: Number(event.target.value) })
                }
              >
                <option value={7}>7</option>
                <option value={11}>11</option>
                <option value={15}>15</option>
              </select>
            </label>

            <label>
              Player Names
              <textarea
                value={setup.playersText}
                onChange={(event) =>
                  setSetup({ ...setup, playersText: event.target.value })
                }
                placeholder={`Enter one player per line:\nAtharva\nRahul\nJay\nVishal`}
                rows={12}
              />
            </label>

            <button type="submit" className="primary-button">
              Generate Tournament
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <section className="card hero-card">
        <div className="top-row">
          <div>
            <p className="eyebrow">Active Tournament</p>
            <h1>{tournament.name}</h1>
            <p className="muted">
              Format:{" "}
              {tournament.format === "GROUP_STAGE_KNOCKOUT"
                ? "Group Stage + Knockout"
                : "Direct Knockout"}{" "}
              · Match Point: {tournament.matchPoint}
            </p>
          </div>

          <div className="actions">
            <button onClick={exportTournament} className="secondary-button">
              Export
            </button>

            <label className="secondary-button file-button">
              Import
              <input type="file" accept="application/json" onChange={importTournament} />
            </label>

            <button onClick={resetTournament} className="danger-button">
              Reset
            </button>
          </div>
        </div>

        {winner && (
          <div className="winner-box">
            🏆 Winner: <strong>{winner}</strong>
          </div>
        )}
      </section>

      <section className="grid two-col">
        <section className="card">
          <h2>Teams</h2>
          <div className="team-list">
            {teams.map((team) => (
              <div className="team-row" key={team.id}>
                <strong>{team.name}</strong>
                <span>{team.players.join(" + ")}</span>
              </div>
            ))}
          </div>
        </section>

        {tournament.format === "GROUP_STAGE_KNOCKOUT" && (
          <section className="card">
            <h2>Groups</h2>
            {groups.map((group) => (
              <div key={group.name} className="group-box">
                <h3>{group.name}</h3>
                {group.teamIds.map((teamId) => (
                  <p key={teamId}>{getTeamName(teams, teamId)}</p>
                ))}
              </div>
            ))}
          </section>
        )}
      </section>

      {tournament.format === "GROUP_STAGE_KNOCKOUT" && (
        <section className="card">
          <h2>Standings</h2>

          <div className="grid two-col">
            {groups.map((group) => {
              const standings = calculateStandings(group, teams, matches);

              return (
                <div key={group.name}>
                  <h3>{group.name}</h3>

                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Rank</th>
                          <th>Team</th>
                          <th>P</th>
                          <th>W</th>
                          <th>L</th>
                          <th>PF</th>
                          <th>PA</th>
                          <th>PD</th>
                        </tr>
                      </thead>
                      <tbody>
                        {standings.map((row, index) => (
                          <tr key={row.teamId}>
                            <td>{index + 1}</td>
                            <td>{getTeamName(teams, row.teamId)}</td>
                            <td>{row.played}</td>
                            <td>{row.wins}</td>
                            <td>{row.losses}</td>
                            <td>{row.pointsFor}</td>
                            <td>{row.pointsAgainst}</td>
                            <td>{row.pointDifference}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="muted small-note">
            Ranking: wins first, then head-to-head for two-team ties, then point
            difference, then points scored.
          </p>
        </section>
      )}

      <section className="card">
        <h2>Matches</h2>

        <div className="match-list">
          {matches.map((match, index) => (
            <div className="match-card" key={match.id}>
              <div className="match-header">
                <div>
                  <strong>Match {index + 1}</strong>
                  <p>
                    {match.day} ·{" "}
                    {match.stage === "KNOCKOUT"
                      ? match.roundName
                      : getStageLabel(match.stage)}
                    {match.groupName ? ` · ${match.groupName}` : ""}
                  </p>
                </div>

                {match.isComplete && (
                  <span className="status-pill">
                    {match.isBye ? "Bye" : "Complete"}
                  </span>
                )}
              </div>

              <div className="score-row">
                <div className="team-name">{getTeamName(teams, match.team1Id)}</div>

                <input
                  type="number"
                  value={match.score1}
                  disabled={match.isBye || !match.team1Id || !match.team2Id}
                  onChange={(event) =>
                    updateMatchScore(match.id, "score1", event.target.value)
                  }
                />
              </div>

              <div className="score-row">
                <div className="team-name">{getTeamName(teams, match.team2Id)}</div>

                <input
                  type="number"
                  value={match.score2}
                  disabled={match.isBye || !match.team1Id || !match.team2Id}
                  onChange={(event) =>
                    updateMatchScore(match.id, "score2", event.target.value)
                  }
                />
              </div>

              {match.winnerId && (
                <p className="winner-line">
                  Winner: <strong>{getTeamName(teams, match.winnerId)}</strong>
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;