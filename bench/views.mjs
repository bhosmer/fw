// The bench's views (bench.mjs), proposed 2026-10-22 and awaiting Basil's
// confirmation (brief E4). Hashes as the app writes them into its URL.
export const VIEWS = {
  // On the plaza where a first visit starts on main, under the great building.
  start: { world: 'arcology', hash: 'eyJ3b3JsZCI6ImFyY29sb2d5IiwiRiI6LTEsImZyYWMiOlswLjk3OTE2NjY2NjY2NjY2NjYsMC4xNzk2ODc1LDAuMjcwODMzMzMzMzMzMzMzM10sImRpZ2l0cyI6W1stMSxbMTMsMywyMV1dXSwieWF3IjowLCJwaXRjaCI6MH0=' },
  // Further back on the plaza, the buildings whole, the plaza to the horizon.
  overview: { world: 'arcology', hash: 'eyJ3b3JsZCI6ImFyY29sb2d5IiwiRiI6LTIsImZyYWMiOlswLjU4MjQ2NTI3Nzc3Nzc3NzgsMC45NTExNTM3NzYwNTY4NzI3LDAuMjUwNzI5MzgzNzA1ODk4NF0sImRpZ2l0cyI6W1stMixbMTIsMTIsMTRdXV0sInlhdyI6MCwicGl0Y2giOjB9' },
  // Close in front of main's buildings' faces (the browser tests' old "relief").
  face: { world: 'arcology', hash: 'eyJ3b3JsZCI6ImFyY29sb2d5IiwiRiI6LTEsImZyYWMiOlswLjUsMC41LDAuNV0sImRpZ2l0cyI6W1stMixbMTIsMTIsMTNdXSxbLTEsWzEyLDIyLDZdXV0sInlhdyI6MCwicGl0Y2giOi0wLjE1fQ==' },
  // The Hexahedron whole, from the plaza two cells off (the build of 2026-10-22 on).
  building: { world: 'arcology', hash: 'eyJ3b3JsZCI6ImFyY29sb2d5IiwiRiI6LTIsImZyYWMiOlswLjUsMC43LDAuM10sImRpZ2l0cyI6W1stMixbMTIsMTIsMTRdXV0sInlhdyI6MCwicGl0Y2giOjAuMTJ9' },
  // Close in front of the Hexahedron's lower, its pockets filling the view (the browser tests' "relief").
  skin: { world: 'arcology', hash: 'eyJ3b3JsZCI6ImFyY29sb2d5IiwiRiI6LTIsImZyYWMiOlswLjQ1LDAuNiwwLjk3XSwiZGlnaXRzIjpbXSwieWF3IjowLCJwaXRjaCI6MC4xNX0=' },
  // In the halls: a small room, a great hall through its doorway (the tests' "doorway").
  halls: { world: 'halls', hash: 'eyJ3b3JsZCI6ImhhbGxzIiwiRiI6NSwiZnJhYyI6WzAuMTM4NDEyMzMxMzYzNzIzOCwwLjIxNDk5MDAyMjQwMTc0MTk4LDAuMTA2Nzk2NzA2MTM0MDM5MjRdLCJkaWdpdHMiOltbLTEsWzcsMTgsMTZdXSxbMCxbMTYsMTcsNV1dLFsxLFsxNSw2LDIxXV0sWzIsWzIwLDcsMl1dLFszLFsyMSw3LDEzXV0sWzQsWzAsMTAsMF1dLFs1LFswLDE2LDBdXV0sInlhdyI6MTMuOTYyNTg5NzIyMjkyMzM2LCJwaXRjaCI6LTAuMzM0NzMzNzg5OTMwOTczMTR9' },
};
