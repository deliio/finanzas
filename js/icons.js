// Iconos de línea monocromos (24×24, trazo) estilo Trade Republic.
// Se pintan con currentColor, así heredan el color del texto.

export const ICONS = {
  cart:     '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.7 12.2a1 1 0 0 0 1 .8h9.7a1 1 0 0 0 1-.8L21 7H6"/>',
  utensils: '<path d="M7 2v20M4 2v6a3 3 0 0 0 6 0V2M17 22V2c-2.5 1-4 4-4 8h4"/>',
  car:      '<path d="M5 17H3v-5l2-5h14l2 5v5h-2M3 12h18M9.5 17h5"/><circle cx="7.5" cy="17" r="2"/><circle cx="16.5" cy="17" r="2"/>',
  home:     '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  film:     '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M7 5v14M17 5v14M2 12h20"/>',
  heart:    '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/>',
  bag:      '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0"/>',
  repeat:   '<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3"/>',
  box:      '<path d="M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8"/>',
  briefcase:'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20"/>',
  plus:     '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
  wallet:   '<path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5M17 14h.01"/>',
  trending: '<path d="m3 17 6-6 4 4 8-8M14 7h7v7"/>',
  bank:     '<path d="M3 21h18M5 21V10M19 21V10M9.7 21V10M14.3 21V10M12 3 2 8h20z"/>',
  card:     '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
};

export const icon = (name, cls = 'ico') =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] ?? ICONS.box}</svg>`;
