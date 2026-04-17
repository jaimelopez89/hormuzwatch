/**
 * VesselDetail — expanded vessel info panel displayed when a vessel is clicked on the map.
 */

const SHIP_TYPES = {
  0:  "Unknown",      20: "WIG",           30: "Fishing",
  31: "Towing",       32: "Towing (large)", 35: "Military Ops",
  36: "Law Enforcement", 37: "Pleasure Craft", 40: "High Speed",
  50: "Pilot",        51: "SAR",           52: "Tug",
  53: "Port Tender",  55: "Law Enforcement", 60: "Passenger",
  69: "Passenger",    70: "Cargo",         71: "Cargo",
  72: "Cargo",        79: "Cargo",         80: "Tanker",
  81: "Tanker",       82: "Tanker",        83: "Tanker",
  84: "LNG Tanker",   85: "LNG Tanker",    89: "Tanker",
  90: "Other",
};

const NAV_STATUSES = {
  0: "Under way (engine)", 1: "At anchor",          2: "Not under command",
  3: "Restricted maneuv.", 4: "Constrained/draught", 5: "Moored",
  6: "Aground",            7: "Fishing",             8: "Under way (sail)",
  15: "Not defined",
};

// ISO 3166-1 alpha-2 → country name (common maritime registries)
const FLAG_NAMES = {
  AE:"UAE", AF:"Afghanistan", AG:"Antigua & Barbuda", AL:"Albania",
  AO:"Angola", AR:"Argentina", AU:"Australia", AZ:"Azerbaijan",
  BD:"Bangladesh", BH:"Bahrain", BJ:"Benin", BN:"Brunei", BR:"Brazil",
  BS:"Bahamas", BZ:"Belize", CK:"Cook Islands", CM:"Cameroon",
  CN:"China", CU:"Cuba", CV:"Cape Verde", CY:"Cyprus",
  DE:"Germany", DJ:"Djibouti", DK:"Denmark", DZ:"Algeria",
  EG:"Egypt", ER:"Eritrea", ES:"Spain", ET:"Ethiopia",
  FI:"Finland", FJ:"Fiji", FR:"France", GA:"Gabon",
  GB:"United Kingdom", GE:"Georgia", GH:"Ghana", GI:"Gibraltar",
  GN:"Guinea", GQ:"Equatorial Guinea", GR:"Greece", GT:"Guatemala",
  GY:"Guyana", HK:"Hong Kong", HN:"Honduras", HR:"Croatia",
  ID:"Indonesia", IL:"Israel", IN:"India", IQ:"Iraq",
  IR:"Iran", IS:"Iceland", IT:"Italy", JM:"Jamaica",
  JO:"Jordan", JP:"Japan", KE:"Kenya", KH:"Cambodia",
  KM:"Comoros", KN:"St Kitts & Nevis", KR:"South Korea", KW:"Kuwait",
  KY:"Cayman Islands", LB:"Lebanon", LR:"Liberia", LY:"Libya",
  MA:"Morocco", MH:"Marshall Islands", MM:"Myanmar", MT:"Malta",
  MU:"Mauritius", MV:"Maldives", MY:"Malaysia", MZ:"Mozambique",
  NG:"Nigeria", NI:"Nicaragua", NL:"Netherlands", NO:"Norway",
  NZ:"New Zealand", OM:"Oman", PA:"Panama", PE:"Peru",
  PG:"Papua New Guinea", PH:"Philippines", PK:"Pakistan", PL:"Poland",
  PR:"Puerto Rico", PT:"Portugal", PW:"Palau", QA:"Qatar",
  RO:"Romania", RU:"Russia", SA:"Saudi Arabia", SC:"Seychelles",
  SD:"Sudan", SG:"Singapore", SI:"Slovenia", SK:"Slovakia",
  SL:"Sierra Leone", SO:"Somalia", SS:"South Sudan", SV:"El Salvador",
  SY:"Syria", TC:"Turks & Caicos", TG:"Togo", TH:"Thailand",
  TK:"Tokelau", TN:"Tunisia", TO:"Tonga", TR:"Turkey",
  TT:"Trinidad & Tobago", TV:"Tuvalu", TW:"Taiwan", TZ:"Tanzania",
  UA:"Ukraine", US:"United States", UY:"Uruguay", VE:"Venezuela",
  VN:"Vietnam", VU:"Vanuatu", WS:"Samoa", YE:"Yemen",
  ZA:"South Africa", ZM:"Zambia", ZW:"Zimbabwe",
  // Territories & dependencies commonly seen in AIS
  AW:"Aruba",         BL:"Saint Barthélemy", BQ:"Bonaire/St Eustatius",
  CC:"Cocos Islands", CW:"Curaçao",          CX:"Christmas Island",
  FO:"Faroe Islands", GG:"Guernsey",         GL:"Greenland",
  GP:"Guadeloupe",    HM:"Heard Island",     IM:"Isle of Man",
  JE:"Jersey",        MF:"Saint Martin",     MQ:"Martinique",
  NC:"New Caledonia", NF:"Norfolk Island",   PF:"French Polynesia",
  PM:"St Pierre & Miquelon", RE:"Réunion",   SJ:"Svalbard",
  SX:"Sint Maarten",  TF:"French S. Territories", WF:"Wallis & Futuna",
  YT:"Mayotte",
};

function flagEmoji(code) {
  if (!code || code.length !== 2) return "";
  const uc = code.toUpperCase();
  if (!/^[A-Z]{2}$/.test(uc)) return "";
  return String.fromCodePoint(
    0x1F1E6 + uc.charCodeAt(0) - 65,
    0x1F1E6 + uc.charCodeAt(1) - 65,
  );
}

// MID (Maritime Identification Digits) — first 3 digits of MMSI → country
const MID_COUNTRIES = {
  201:"Albania",202:"Andorra",203:"Austria",204:"Azores/Portugal",205:"Belgium",
  206:"Belarus",207:"Bulgaria",208:"Vatican",209:"Cyprus",210:"Cyprus",
  211:"Germany",212:"Cyprus",213:"Georgia",214:"Moldova",215:"Malta",
  216:"Armenia",218:"Germany",219:"Denmark",220:"Denmark",224:"Spain",
  225:"Spain",226:"France",227:"France",228:"France",229:"Malta",
  230:"Finland",231:"Faroe Islands",232:"United Kingdom",233:"United Kingdom",
  234:"United Kingdom",235:"United Kingdom",236:"Gibraltar",237:"Greece",
  238:"Croatia",239:"Greece",240:"Greece",241:"Greece",242:"Morocco",
  243:"Hungary",244:"Netherlands",245:"Netherlands",246:"Netherlands",
  247:"Italy",248:"Malta",249:"Malta",250:"Ireland",251:"Iceland",
  252:"Liechtenstein",253:"Luxembourg",254:"Monaco",255:"Madeira/Portugal",
  256:"Malta",257:"Norway",258:"Norway",259:"Norway",261:"Poland",
  262:"Montenegro",263:"Portugal",264:"Romania",265:"Sweden",266:"Sweden",
  267:"Slovakia",268:"San Marino",269:"Switzerland",270:"Czech Republic",
  271:"Turkey",272:"Ukraine",273:"Russia",274:"FYR Macedonia",275:"Latvia",
  276:"Estonia",277:"Lithuania",278:"Slovenia",279:"Serbia",
  301:"Anguilla",303:"Alaska/USA",304:"Antigua & Barbuda",305:"Antigua & Barbuda",
  306:"Dutch Caribbean",307:"Aruba",308:"Bahamas",309:"Bahamas",
  310:"Bermuda",311:"Bahamas",312:"Belize",314:"Barbados",316:"Canada",
  319:"Cayman Islands",321:"Costa Rica",323:"Cuba",325:"Dominica",
  327:"Dominican Republic",329:"Guadeloupe",330:"Grenada",331:"Greenland",
  332:"Guatemala",334:"Honduras",336:"Haiti",338:"USA",339:"Jamaica",
  341:"St Kitts & Nevis",343:"St Lucia",345:"Mexico",347:"Martinique",
  348:"Montserrat",350:"Nicaragua",351:"Panama",352:"Panama",353:"Panama",
  354:"Panama",355:"Panama",356:"Panama",357:"Panama",358:"Puerto Rico",
  359:"El Salvador",361:"St Pierre & Miquelon",362:"Trinidad & Tobago",
  364:"Turks & Caicos",366:"USA",367:"USA",368:"USA",369:"USA",
  370:"Panama",371:"Panama",372:"Panama",373:"Panama",374:"Panama",
  375:"St Vincent & Grenadines",376:"St Vincent & Grenadines",
  377:"St Vincent & Grenadines",378:"British Virgin Islands",
  379:"US Virgin Islands",
  401:"Afghanistan",403:"Saudi Arabia",405:"Bangladesh",408:"Bahrain",
  410:"Bhutan",412:"China",413:"China",414:"China",416:"Taiwan",
  417:"Sri Lanka",419:"India",422:"Iran",423:"Azerbaijan",425:"Iraq",
  428:"Israel",431:"Japan",432:"Japan",434:"Turkmenistan",436:"Kazakhstan",
  437:"Uzbekistan",438:"Jordan",440:"South Korea",441:"South Korea",
  443:"Palestine",445:"DPR Korea",447:"Kuwait",450:"Lebanon",
  451:"Kyrgyzstan",453:"Macau",455:"Maldives",457:"Mongolia",
  459:"Nepal",461:"Oman",463:"Pakistan",466:"Qatar",468:"Syria",
  470:"UAE",471:"UAE",472:"UAE",473:"UAE",474:"UAE",
  477:"Hong Kong",478:"Bosnia & Herzegovina",
  501:"Antarctic",503:"Australia",506:"Myanmar",508:"Brunei",
  510:"Micronesia",511:"Palau",512:"New Zealand",514:"Cambodia",
  515:"Cambodia",516:"Christmas Island",518:"Cook Islands",520:"Fiji",
  523:"Cocos Islands",525:"Indonesia",529:"Kiribati",531:"Laos",
  533:"Malaysia",536:"Northern Mariana Islands",538:"Marshall Islands",
  540:"New Caledonia",542:"Niue",544:"Nauru",546:"French Polynesia",
  548:"Philippines",553:"Papua New Guinea",555:"Pitcairn Islands",
  557:"Solomon Islands",559:"American Samoa",561:"Samoa",563:"Singapore",
  564:"Singapore",565:"Singapore",566:"Singapore",567:"Thailand",
  570:"Tonga",572:"Tuvalu",574:"Vietnam",576:"Vanuatu",
  577:"Wallis & Futuna",578:"Vanuatu",
  601:"South Africa",603:"Angola",605:"Algeria",607:"St Paul/Amsterdam",
  608:"Ascension Island",609:"Burundi",610:"Benin",611:"Botswana",
  612:"Central African Rep",613:"Cameroon",615:"Congo",616:"Comoros",
  617:"Cape Verde",618:"Antarctic",619:"Ivory Coast",620:"Comoros",
  621:"Djibouti",622:"Egypt",624:"Ethiopia",625:"Eritrea",626:"Gabon",
  627:"Ghana",629:"Gambia",630:"Guinea-Bissau",631:"Equatorial Guinea",
  632:"Guinea",633:"Burkina Faso",634:"Kenya",635:"Kerguelen",
  636:"Liberia",637:"Liberia",638:"South Sudan",642:"Libya",644:"Lesotho",
  645:"Mauritius",647:"Madagascar",649:"Mali",650:"Mozambique",
  654:"Mauritania",655:"Malawi",656:"Niger",657:"Nigeria",659:"Namibia",
  660:"Reunion",661:"Rwanda",662:"Sudan",663:"Senegal",664:"Seychelles",
  665:"St Helena",666:"Somalia",667:"Sierra Leone",668:"Sao Tome & Principe",
  669:"Swaziland",670:"Chad",671:"Togo",672:"Tunisia",674:"Tanzania",
  675:"Uganda",676:"DRC",677:"Tanzania",678:"Zambia",679:"Zimbabwe",
  701:"Argentina",710:"Brazil",720:"Bolivia",725:"Chile",730:"Colombia",
  735:"Ecuador",740:"Falkland Islands",745:"Guiana/France",750:"Guyana",
  755:"Paraguay",760:"Peru",765:"Suriname",770:"Uruguay",775:"Venezuela",
};

function getMidCountry(mmsi) {
  const mid = Math.floor(parseInt(mmsi, 10) / 1000000);
  return MID_COUNTRIES[mid] || null;
}

const SANCTIONED_MMSIS = new Set([
  271000835, 271000836, 271000837,
  422023900, 422030700, 422060300, 422100600, 422112200, 422134400,
  422301600, 422310000, 422316000,
  657570200, 657570300, 657570400,
  511101390, 511101394, 538007800, 538008900, 577305000,
  352002785, 636091798,
]);

function Row({ label, value, highlight, link }) {
  return (
    <div className="flex justify-between items-baseline gap-2 py-0.5 border-b border-border last:border-0">
      <span className="text-dimtext text-xs shrink-0">{label}</span>
      {link
        ? <a href={link} target="_blank" rel="noopener noreferrer"
            className="font-mono text-xs text-right truncate"
            style={{ color: "#00d4ff", textDecoration: "none" }}>{value}</a>
        : <span className={`font-mono text-xs text-right ${highlight || "text-bright"}`}>{value}</span>
      }
    </div>
  );
}

export function VesselDetail({ vessel, onClose }) {
  if (!vessel) return null;

  // Mapbox GeoJSON properties can arrive as strings — normalize numbers
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

  const mmsi = parseInt(vessel.mmsi, 10) || 0;
  const sanctioned = SANCTIONED_MMSIS.has(mmsi);
  const shipTypeNum = parseInt(vessel.shipType || vessel.ship_type || 0, 10);
  const shipTypeName = SHIP_TYPES[shipTypeNum]
    || SHIP_TYPES[Math.floor(shipTypeNum / 10) * 10]
    || "Unknown";
  const navStatus = NAV_STATUSES[vessel.navStatus ?? vessel.nav_status] ?? NAV_STATUSES[15];
  const isMilitary = shipTypeNum === 35 || shipTypeNum === 36;
  const midCountry = getMidCountry(vessel.mmsi);
  const mid = Math.floor(mmsi / 1_000_000);
  const ADVERSARY_MIDS = new Set([422, 273, 468, 445]);   // Iran, Russia, Syria, DPRK
  const ADVERSARY_FLAGS = new Set(["IR", "RU", "SY", "KP", "YE"]);  // + Yemen (Houthi); UAE/IQ are not adversary
  const flagCodeForAdversary = typeof vessel.flag === "string" ? vessel.flag.toUpperCase().trim() : null;
  const isAdversary = !sanctioned && (ADVERSARY_MIDS.has(mid) || (flagCodeForAdversary && ADVERSARY_FLAGS.has(flagCodeForAdversary)));

  const flagCode = typeof vessel.flag === "string" && vessel.flag.length === 2
    ? vessel.flag.toUpperCase() : null;
  const emoji = flagEmoji(flagCode);
  const flagName = (flagCode && FLAG_NAMES[flagCode]) || midCountry || vessel.flag || "—";
  const flagDisplay = emoji ? `${emoji}  ${flagName}` : flagName;

  const mtLink  = `https://www.marinetraffic.com/en/ais/details/ships/mmsi:${vessel.mmsi}`;
  const vfLink  = `https://www.vesselfinder.com/vessels/details/${vessel.mmsi}`;

  return (
    <div
      className="absolute bottom-4 left-4 z-20 rounded"
      style={{
        background: "#060d18",
        border: `1px solid ${sanctioned ? "#ef4444" : isMilitary ? "#f97316" : isAdversary ? "#fbbf24" : "#0f2a40"}`,
        boxShadow: sanctioned ? "0 0 20px #ef444444" : isAdversary ? "0 0 16px #fbbf2433" : "0 0 12px #00000066",
        width: 290,
        padding: 14,
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="font-mono text-xs text-dimtext tracking-widest mb-0.5">// VESSEL DETAIL</div>
          <div className="font-bold text-sm text-bright leading-tight">
            {vessel.name || "UNKNOWN"}
          </div>
          {midCountry && (
            <div className="font-mono text-xs mt-0.5" style={{ color: "#94a3b8" }}>
              {midCountry} registry
            </div>
          )}
        </div>
        <button
          className="text-dimtext hover:text-bright font-mono text-xs ml-2"
          onClick={onClose}
        >✕</button>
      </div>

      {/* Sanctions warning */}
      {sanctioned && (
        <div className="mb-2 px-2 py-1 rounded text-xs font-mono font-bold text-critical"
          style={{ background: "#2a0505", border: "1px solid #ef4444" }}>
          ⚠ OFAC/EU SANCTIONED VESSEL
        </div>
      )}
      {isMilitary && !sanctioned && (
        <div className="mb-2 px-2 py-1 rounded text-xs font-mono font-bold text-high"
          style={{ background: "#1a0a05", border: "1px solid #f97316" }}>
          ⚔ MILITARY / LAW ENFORCEMENT
        </div>
      )}
      {isAdversary && (
        <div className="mb-2 px-2 py-1 rounded text-xs font-mono font-bold"
          style={{ background: "#1a1200", border: "1px solid #fbbf24", color: "#fbbf24" }}>
          ◆ ADVERSARY-STATE FLAGGED — {midCountry || "Unknown registry"}
        </div>
      )}

      {/* Data rows */}
      <div className="flex flex-col">
        <Row label="MMSI"       value={vessel.mmsi} />
        {vessel.imo  && <Row label="IMO"  value={vessel.imo} />}
        <Row label="Type"       value={shipTypeName} />
        <Row label="Flag"       value={flagDisplay} />
        <Row label="Status"     value={navStatus} />
        <Row label="Speed"      value={`${num(vessel.speed).toFixed(1)} kt`} />
        <Row label="Course"     value={`${num(vessel.course)}°`} />
        <Row label="Heading"    value={num(vessel.heading) === 511 || !vessel.heading ? "—" : `${num(vessel.heading)}°`} />
        {vessel.draught && <Row label="Draught" value={`${num(vessel.draught)} m`} />}
        {vessel.destination && <Row label="Dest." value={vessel.destination} />}
        <Row label="Position"   value={`${num(vessel.lat).toFixed(4)}°N, ${num(vessel.lon).toFixed(4)}°E`} />
      </div>

      {/* External links */}
      <div className="mt-3 flex gap-2">
        <a
          href={mtLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-center text-xs font-mono py-1 rounded border transition-colors"
          style={{ borderColor: "#0f2a40", color: "#00d4ff", textDecoration: "none" }}
        >
          MarineTraffic ↗
        </a>
        <a
          href={vfLink}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-1 text-center text-xs font-mono py-1 rounded border transition-colors"
          style={{ borderColor: "#0f2a40", color: "#94a3b8", textDecoration: "none" }}
        >
          VesselFinder ↗
        </a>
      </div>
    </div>
  );
}
