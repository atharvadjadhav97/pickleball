import { useEffect, useMemo, useState } from "react";
import "./App.css";

import {
  createTournamentInDb,
  loadTournamentFromDb,
  updateTournamentInDb,
} from "./lib/tournamentStore";

const STORAGE_KEY = "pickleball_tournaments_v2";

function loadSavedTournaments() {
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) : [];
}

function saveTournaments(tournaments) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tournaments));
}

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

function makeAdminToken() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getStoredAdminTokens() {
  const saved = localStorage.getItem("pickleball_admin_tokens_v1");
  return saved ? JSON.parse(saved) : {};
}

function saveAdminToken(remoteId, adminToken) {
  const tokens = getStoredAdminTokens();
  tokens[remoteId] = adminToken;
  localStorage.setItem("pickleball_admin_tokens_v1", JSON.stringify(tokens));
}

function hasStoredAdminToken(remoteId, adminToken) {
  const tokens = getStoredAdminTokens();
  return tokens[remoteId] === adminToken;
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

function createRoundRobinRounds(teams) {
  const participants = [...teams];

  if (participants.length % 2 !== 0) {
    participants.push(null);
  }

  const rounds = [];
  const totalRounds = participants.length - 1;

  for (let roundIndex = 0; roundIndex < totalRounds; roundIndex++) {
    const roundPairs = [];

    for (let i = 0; i < participants.length / 2; i++) {
      const team1 = participants[i];
      const team2 = participants[participants.length - 1 - i];

      if (team1 && team2) {
        roundPairs.push({ team1, team2 });
      }
    }

    rounds.push(roundPairs);

    const fixed = participants[0];
    const rotating = participants.slice(1);
    rotating.unshift(rotating.pop());
    participants.splice(0, participants.length, fixed, ...rotating);
  }

  return rounds;
}

function createGroupTournament(teams, courtCount = 4) {
  const groupASize = Math.ceil(teams.length / 2);
  const groupA = teams.slice(0, groupASize);
  const groupB = teams.slice(groupASize);

  const groups = [
    { name: "Group A", teamIds: groupA.map((team) => team.id) },
    { name: "Group B", teamIds: groupB.map((team) => team.id) },
  ];

  const groupARounds = createRoundRobinRounds(groupA);
  const groupBRounds = createRoundRobinRounds(groupB);

  const maxRounds = Math.max(groupARounds.length, groupBRounds.length);
  const matches = [];
  let timeSlot = 1;

  for (let roundIndex = 0; roundIndex < maxRounds; roundIndex++) {
    const roundMatches = [
      ...(groupARounds[roundIndex] || []).map((pair) => ({
        ...pair,
        groupName: "Group A",
      })),
      ...(groupBRounds[roundIndex] || []).map((pair) => ({
        ...pair,
        groupName: "Group B",
      })),
    ];

    for (let i = 0; i < roundMatches.length; i += courtCount) {
      const courtBatch = roundMatches.slice(i, i + courtCount);

      courtBatch.forEach((pair, courtIndex) => {
        matches.push({
          id: makeId("match"),
          day: "Day 1",
          stage: "GROUP",
          groupName: pair.groupName,
          roundIndex,
          timeSlot,
          courtNumber: courtIndex + 1,
          team1Id: pair.team1.id,
          team2Id: pair.team2.id,
          score1: "",
          score2: "",
          winnerId: null,
          isComplete: false,
        });
      });

      timeSlot += 1;
    }
  }

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

function getTournamentWinner(tournament) {
  if (!tournament) return null;

  const teams = tournament.teams || [];
  const matches = tournament.matches || [];

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
}

function getCompletedMatchCount(tournament) {
  return tournament.matches.filter((match) => match.isComplete && !match.isBye).length;
}

function App() {
  const [tournaments, setTournaments] = useState(() => loadSavedTournaments());
  const [activeTournamentId, setActiveTournamentId] = useState(null);
  const [scoreMode, setScoreMode] = useState(false);
  const [showCompletedMatches, setShowCompletedMatches] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Local only");
  const [isLoadingRemoteTournament, setIsLoadingRemoteTournament] = useState(false);

  const [setup, setSetup] = useState({
    name: "Saturday Pickleball",
    format: "GROUP_STAGE_KNOCKOUT",
    playersText: "",
    matchPoint: 11,
    courtCount: 4,
  });

  useEffect(() => {
    saveTournaments(tournaments);
  }, [tournaments]);

  useEffect(() => {
    async function loadSharedTournament() {
      const params = new URLSearchParams(window.location.search);
      const remoteId = params.get("tournament");

      if (!remoteId) return;

      const alreadyLoaded = tournaments.some(
        (tournament) => tournament.remoteId === remoteId
      );

      if (alreadyLoaded) {
        const existingTournament = tournaments.find(
          (tournament) => tournament.remoteId === remoteId
        );
        setActiveTournamentId(existingTournament.id);
        return;
      }

      setIsLoadingRemoteTournament(true);
      setSyncStatus("Loading shared tournament...");

      const { data, error } = await loadTournamentFromDb(remoteId);

      if (error) {
        console.error(error);
        setSyncStatus("Failed to load shared tournament");
        setIsLoadingRemoteTournament(false);
        return;
      }

      const remoteTournament = {
        ...data.data,
        remoteId: data.id,
        updatedAt: data.updated_at,
      };

      const editToken = params.get("edit");

        if (editToken && editToken === remoteTournament.adminToken) {
          saveAdminToken(data.id, remoteTournament.adminToken);
       }
      setTournaments((current) => {
        const exists = current.some((item) => item.remoteId === remoteId);
        if (exists) return current;
        return [remoteTournament, ...current];
      });

      setActiveTournamentId(remoteTournament.id);
      setSyncStatus("Loaded from Supabase");
      setIsLoadingRemoteTournament(false);
    }

    loadSharedTournament();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeTournament = useMemo(
    () => tournaments.find((item) => item.id === activeTournamentId) || null,
    [tournaments, activeTournamentId]
  );

  const isAdmin = useMemo(() => {
    if (!activeTournament) return false;

    // Local-only tournaments can be edited.
    if (!activeTournament.remoteId) return true;

    const params = new URLSearchParams(window.location.search);
    const tournamentIdFromUrl = params.get("tournament");
    const editToken = params.get("edit");

    // If this tournament was opened through a shared URL,
    // require the edit token. No token = view-only.
    if (tournamentIdFromUrl === activeTournament.remoteId) {
      return Boolean(editToken && editToken === activeTournament.adminToken);
    }

    // If opened from your own dashboard/local saved list, allow edit.
    return true;
  }, [activeTournament]);

  const teams = activeTournament?.teams || [];
  const matches = activeTournament?.matches || [];
  const groups = activeTournament?.groups || [];

  const winner = useMemo(
    () => getTournamentWinner(activeTournament),
    [activeTournament]
  );

  function updateActiveTournament(updater) {
    setTournaments((currentTournaments) => {
      let tournamentToSync = null;

      const nextTournaments = currentTournaments.map((tournament) => {
        if (tournament.id !== activeTournamentId) return tournament;

        const updatedTournament =
          typeof updater === "function" ? updater(tournament) : updater;

        tournamentToSync = {
          ...updatedTournament,
          updatedAt: new Date().toISOString(),
        };

        return tournamentToSync;
      });

      if (tournamentToSync?.remoteId) {
        setSyncStatus("Saving online...");

        updateTournamentInDb(tournamentToSync).then(({ error }) => {
          if (error) {
            console.error(error);
            setSyncStatus("Online save failed");
          } else {
            setSyncStatus("Saved online");
          }
        });
      } else {
        setSyncStatus("Local only");
      }

      return nextTournaments;
    });
  }
  
  function getShareLink(tournament) {
    if (!tournament?.remoteId) return "";

    const publicAppUrl =
      import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin;

    const url = new URL(publicAppUrl);
    url.searchParams.set("tournament", tournament.remoteId);

    return url.toString();
  }

  function getAdminLink(tournament) {
    if (!tournament?.remoteId || !tournament?.adminToken) return "";

    const publicAppUrl =
      import.meta.env.VITE_PUBLIC_APP_URL || window.location.origin;

    const url = new URL(publicAppUrl);
    url.searchParams.set("tournament", tournament.remoteId);
    url.searchParams.set("edit", tournament.adminToken);

    return url.toString();
  }

  async function copyShareLink() {
    if (!activeTournament?.remoteId) {
      alert("This tournament is not saved online yet.");
      return;
    }

    await navigator.clipboard.writeText(getShareLink(activeTournament));
    alert("Tournament link copied.");
  }

  async function copyAdminLink() {
    if (!activeTournament?.remoteId || !activeTournament?.adminToken) {
      alert("Admin link is not available for this tournament.");
      return;
    }

    await navigator.clipboard.writeText(getAdminLink(activeTournament));
    alert("Admin edit link copied.");
}

  async function handleCreateTournament(event) {
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

    if (setup.format === "GROUP_STAGE_KNOCKOUT" && generatedTeams.length < 4) {
      alert(
        "Group Stage + Knockout needs at least 8 players / 4 teams. Use Direct Knockout for fewer players."
      );
      return;
    }

    let generatedGroups = [];
    let generatedMatches = [];

    if (setup.format === "GROUP_STAGE_KNOCKOUT") {
      const result = createGroupTournament(generatedTeams, setup.courtCount);
      generatedGroups = result.groups;
      generatedMatches = result.matches;
    } else {
      generatedMatches = createKnockoutFirstRound(generatedTeams);
    }

    const newTournament = {
      id: makeId("tournament"),
      adminToken: makeAdminToken(),
      name: setup.name || "Pickleball Tournament",
      format: setup.format,
      matchPoint: setup.matchPoint,
      courtCount: setup.courtCount,
      players,
      teams: generatedTeams,
      groups: generatedGroups,
      matches: generatedMatches,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setTournaments((current) => [newTournament, ...current]);
    setActiveTournamentId(newTournament.id);
    setSyncStatus("Saving online...");

    const { data, error } = await createTournamentInDb(newTournament);

    if (error) {
      console.error(error);
      setSyncStatus("Saved locally only");
    } else {
      const tournamentWithRemoteId = {
        ...newTournament,
        remoteId: data.id,
        updatedAt: data.updated_at,
      };
      saveAdminToken(data.id, tournamentWithRemoteId.adminToken);

      setTournaments((current) =>
        current.map((item) =>
          item.id === newTournament.id ? tournamentWithRemoteId : item
        )
      );

      setActiveTournamentId(tournamentWithRemoteId.id);
      setSyncStatus("Saved online");
    }

    setSetup({
      name: "Saturday Pickleball",
      format: "GROUP_STAGE_KNOCKOUT",
      playersText: "",
      matchPoint: 11,
      courtCount: 4,
    });
  }

  function updateMatchScore(matchId, field, value) {

    if (!isAdmin) {
      alert("This is a view-only link. Use the admin link to edit scores.");
      return;
    }
    updateActiveTournament((current) => {
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

  function changeScoreBy(match, field, delta) {
    const currentValue = Number(match[field] || 0);
    const nextValue = Math.max(0, currentValue + delta);

    updateMatchScore(match.id, field, String(nextValue));
  }

  function getVisibleMatches() {
    if (!scoreMode) return matches;

    const pendingMatches = matches.filter((match) => !match.isComplete);
    const completedMatches = matches.filter((match) => match.isComplete);

    if (showCompletedMatches) {
      return [...pendingMatches, ...completedMatches];
    }

    return pendingMatches;
  }

  function deleteTournament(tournamentId) {
    const confirmed = window.confirm("Delete this tournament?");
    if (!confirmed) return;

    setTournaments((current) => current.filter((item) => item.id !== tournamentId));

    if (activeTournamentId === tournamentId) {
      setActiveTournamentId(null);
    }
  }

  function exportTournament(tournamentToExport = activeTournament) {
    if (!tournamentToExport) return;

    const file = new Blob([JSON.stringify(tournamentToExport, null, 2)], {
      type: "application/json",
    });

    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${tournamentToExport.name.replaceAll(" ", "_")}.json`;
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
        const importedTournament = {
          ...imported,
          id: imported.id || makeId("tournament"),
          updatedAt: new Date().toISOString(),
        };

        setTournaments((current) => [importedTournament, ...current]);
        setActiveTournamentId(importedTournament.id);
      } catch {
        alert("Invalid tournament file.");
      }
    };

    reader.readAsText(file);
    event.target.value = "";
  }

  if (isLoadingRemoteTournament) {
    return (
      <main className="page">
        <section className="card hero-card">
          <p className="eyebrow">Pickleball Utility</p>
          <h1>Loading tournament...</h1>
          <p className="muted">Fetching shared tournament from Supabase.</p>
        </section>
      </main>
    );
  }

  if (!activeTournament) {
    return (
      <main className="page">
        <section className="card hero-card">
          <p className="eyebrow">Pickleball Utility</p>
          <h1>Tournament Dashboard</h1>
          <p className="muted">
            Create multiple tournaments, open old tournaments, enter scores, and
            keep everything saved in this browser.
          </p>
          <p className="muted small-note">Sync: {syncStatus}</p>
        </section>

        <section className="grid two-col dashboard-grid">
          <section className="card">
            <h2>Create New Tournament</h2>

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
                    setSetup({
                      ...setup,
                      matchPoint: Number(event.target.value),
                    })
                  }
                >
                  <option value={7}>7</option>
                  <option value={11}>11</option>
                  <option value={15}>15</option>
                </select>
              </label>

              <label>
                Number of Courts
                <select
                  value={setup.courtCount}
                  onChange={(event) =>
                    setSetup({
                      ...setup,
                      courtCount: Number(event.target.value),
                    })
                  }
                >
                  <option value={1}>1 Court</option>
                  <option value={2}>2 Courts</option>
                  <option value={3}>3 Courts</option>
                  <option value={4}>4 Courts</option>
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

          <section className="card">
            <div className="section-header">
              <div>
                <h2>Saved Tournaments</h2>
                <p className="muted small-note">
                  Stored locally in this browser. Online tournaments also have share links.
                </p>
              </div>

              <label className="secondary-button file-button compact-button">
                Import
                <input
                  type="file"
                  accept="application/json"
                  onChange={importTournament}
                />
              </label>
            </div>

            {tournaments.length === 0 ? (
              <div className="empty-state">
                <p>No saved tournaments yet.</p>
                <p className="muted">Create one from the form on the left.</p>
              </div>
            ) : (
              <div className="saved-list">
                {tournaments.map((tournament) => {
                  const tournamentWinner = getTournamentWinner(tournament);
                  const completedMatches = getCompletedMatchCount(tournament);

                  return (
                    <div className="saved-card" key={tournament.id}>
                      <div>
                        <h3>{tournament.name}</h3>
                        <p className="muted">
                          {tournament.format === "GROUP_STAGE_KNOCKOUT"
                            ? "Group Stage + Knockout"
                            : "Direct Knockout"}{" "}
                          · {tournament.teams.length} teams ·{" "}
                          {completedMatches}/{tournament.matches.length} matches
                          completed
                          {tournament.remoteId ? " · Online" : " · Local"}
                        </p>

                        {tournamentWinner && (
                          <p className="winner-mini">🏆 {tournamentWinner}</p>
                        )}
                      </div>

                      <div className="saved-actions">
                        <button
                          className="primary-button compact-button"
                          onClick={() => setActiveTournamentId(tournament.id)}
                        >
                          Open
                        </button>
                        <button
                          className="secondary-button compact-button"
                          onClick={() => exportTournament(tournament)}
                        >
                          Export
                        </button>
                        <button
                          className="danger-button compact-button"
                          onClick={() => deleteTournament(tournament.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
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
            <h1>{activeTournament.name}</h1>
            <p className="muted">
              Format:{" "}
              {activeTournament.format === "GROUP_STAGE_KNOCKOUT"
                ? "Group Stage + Knockout"
                : "Direct Knockout"}{" "}
              · Match Point: {activeTournament.matchPoint}
              {activeTournament.courtCount
                ? ` · Courts: ${activeTournament.courtCount}`
                : ""}
            </p>
            <p className="muted small-note">
              Sync: {syncStatus}
              {activeTournament.remoteId ? " · Online tournament" : " · Local only"}
              {activeTournament.remoteId
                ? isAdmin
                  ? " · Edit access"
                  : " · View only"
                : ""}
            </p>
          </div>

          <div className="actions">
            <button
              onClick={() => setActiveTournamentId(null)}
              className="secondary-button"
            >
              Dashboard
            </button>

            <button
              onClick={() => setScoreMode((current) => !current)}
              className={scoreMode ? "primary-button" : "secondary-button"}
            >
              {scoreMode ? "Full View" : "Score Mode"}
            </button>

            <button
              onClick={copyShareLink}
              className="secondary-button"
              disabled={!activeTournament.remoteId}
            >
              Share Link
            </button>

            <button
              onClick={copyAdminLink}
              className="secondary-button"
              disabled={!activeTournament.remoteId || !isAdmin}
            >
              Admin Link
          </button>

            <button
              onClick={() => exportTournament(activeTournament)}
              className="secondary-button"
            >
              Export
            </button>

            <button
              onClick={() => deleteTournament(activeTournament.id)}
              className="danger-button"
            >
              Delete
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

        {activeTournament.format === "GROUP_STAGE_KNOCKOUT" && (
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

      {activeTournament.format === "GROUP_STAGE_KNOCKOUT" && (
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

        {scoreMode && (
          <div className="score-mode-bar">
            <div>
              <strong>Score Mode</strong>
              <p className="muted small-note">
                Showing pending matches first for quick phone scoring.
              </p>
            </div>

            <button
              className="secondary-button compact-button"
              onClick={() => setShowCompletedMatches((current) => !current)}
            >
              {showCompletedMatches ? "Hide Completed" : "Show Completed"}
            </button>
          </div>
        )}

        <div className="match-list">
          {getVisibleMatches().map((match, index) => (
            <div className="match-card" key={match.id}>
              <div className="match-header">
                <div>
                  <strong>
                    {scoreMode && match.timeSlot
                      ? `Slot ${match.timeSlot} · Court ${match.courtNumber || "-"}`
                      : `Match ${index + 1}`}
                  </strong>
                  <p>
                    {match.day} ·{" "}
                    {match.stage === "KNOCKOUT"
                      ? match.roundName
                      : getStageLabel(match.stage)}
                    {match.groupName ? ` · ${match.groupName}` : ""}
                    {match.timeSlot ? ` · Slot ${match.timeSlot}` : ""}
                    {match.courtNumber ? ` · Court ${match.courtNumber}` : ""}
                  </p>
                </div>

                {match.isComplete && (
                  <span className="status-pill">
                    {match.isBye ? "Bye" : "Complete"}
                  </span>
                )}
              </div>

              <div className={scoreMode ? "mobile-score-row" : "score-row"}>
                <div className="team-name">{getTeamName(teams, match.team1Id)}</div>

                {scoreMode ? (
                  <div className="score-controls">
                    <button
                      type="button"
                      disabled={!isAdmin || match.isBye || !match.team1Id || !match.team2Id}
                      onClick={() => changeScoreBy(match, "score1", -1)}
                    >
                      −
                    </button>

                    <input
                      type="number"
                      value={match.score1}
                      disabled={!isAdmin || match.isBye || !match.team1Id || !match.team2Id}
                      onChange={(event) =>
                        updateMatchScore(match.id, "score1", event.target.value)
                      }
                    />

                    <button
                      type="button"
                      disabled={!isAdmin || match.isBye || !match.team1Id || !match.team2Id}
                      onClick={() => changeScoreBy(match, "score1", 1)}
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <input
                    type="number"
                    value={match.score1}
                    disabled={!isAdmin || match.isBye || !match.team1Id || !match.team2Id}
                    onChange={(event) =>
                      updateMatchScore(match.id, "score1", event.target.value)
                    }
                  />
                )}
              </div>

              <div className={scoreMode ? "mobile-score-row" : "score-row"}>
                <div className="team-name">{getTeamName(teams, match.team2Id)}</div>

                {scoreMode ? (
                  <div className="score-controls">
                    <button
                      type="button"
                      disabled={!isAdmin || match.isBye || !match.team1Id || !match.team2Id}
                      onClick={() => changeScoreBy(match, "score2", -1)}
                    >
                      −
                    </button>

                    <input
                      type="number"
                      value={match.score2}
                      disabled={!isAdmin || match.isBye || !match.team1Id || !match.team2Id}
                      onChange={(event) =>
                        updateMatchScore(match.id, "score2", event.target.value)
                      }
                    />

                    <button
                      type="button"
                      disabled={!isAdmin || match.isBye || !match.team1Id || !match.team2Id}
                      onClick={() => changeScoreBy(match, "score2", 1)}
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <input
                    type="number"
                    value={match.score2}
                    disabled={!isAdmin || match.isBye || !match.team1Id || !match.team2Id}
                    onChange={(event) =>
                      updateMatchScore(match.id, "score2", event.target.value)
                    }
                  />
                )}
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