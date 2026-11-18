/**
 * Skills taxonomy for the heuristic parser and matcher: canonical name -> aliases.
 * Matching is case-insensitive on word boundaries. Extend freely; the AI parser is not limited to it.
 */
export const SKILL_ALIASES: Record<string, string[]> = {
  // Languages
  JavaScript: ["javascript", "js", "es6", "ecmascript"],
  TypeScript: ["typescript", "ts"],
  Python: ["python", "python3"],
  Java: ["java"],
  "C#": ["c#", "csharp", "c sharp"],
  "C++": ["c++", "cpp"],
  C: ["c programming", "ansi c"],
  Go: ["golang", "go lang"],
  Rust: ["rust"],
  PHP: ["php"],
  Ruby: ["ruby"],
  Kotlin: ["kotlin"],
  Swift: ["swift"],
  Dart: ["dart"],
  Scala: ["scala"],
  R: ["r programming", "r language"],
  SQL: ["sql"],
  Bash: ["bash", "shell scripting"],
  // Frontend
  React: ["react", "react.js", "reactjs"],
  "Next.js": ["next.js", "nextjs"],
  Angular: ["angular", "angularjs"],
  "Vue.js": ["vue", "vue.js", "vuejs"],
  Svelte: ["svelte"],
  HTML: ["html", "html5"],
  CSS: ["css", "css3"],
  "Tailwind CSS": ["tailwind", "tailwindcss", "tailwind css"],
  Bootstrap: ["bootstrap"],
  Redux: ["redux"],
  jQuery: ["jquery"],
  // Backend
  "Node.js": ["node", "node.js", "nodejs"],
  "Express.js": ["express.js", "expressjs", "express framework"],
  NestJS: ["nestjs", "nest.js"],
  Django: ["django"],
  Flask: ["flask"],
  FastAPI: ["fastapi"],
  Spring: ["spring boot", "springboot", "spring framework", "spring mvc"],
  Laravel: ["laravel"],
  ".NET": [".net", "dotnet", "asp.net", ".net core"],
  "Ruby on Rails": ["rails", "ruby on rails"],
  GraphQL: ["graphql"],
  "REST APIs": ["restful", "rest api", "rest apis", "restful api"],
  gRPC: ["grpc"],
  Microservices: ["microservices", "microservice"],
  // Mobile
  "React Native": ["react native"],
  Flutter: ["flutter"],
  Android: ["android"],
  iOS: ["ios"],
  // Data
  PostgreSQL: ["postgresql", "postgres"],
  MySQL: ["mysql"],
  MongoDB: ["mongodb", "mongo"],
  Redis: ["redis"],
  Elasticsearch: ["elasticsearch", "elastic search"],
  Oracle: ["oracle db", "oracle database", "pl/sql"],
  "SQL Server": ["sql server", "mssql"],
  Kafka: ["kafka"],
  RabbitMQ: ["rabbitmq"],
  Spark: ["spark", "pyspark", "apache spark"],
  Pandas: ["pandas"],
  NumPy: ["numpy"],
  "Machine Learning": ["machine learning", "ml"],
  "Deep Learning": ["deep learning"],
  TensorFlow: ["tensorflow"],
  PyTorch: ["pytorch"],
  "scikit-learn": ["scikit-learn", "sklearn"],
  NLP: ["nlp", "natural language processing"],
  "Computer Vision": ["computer vision", "opencv"],
  "Data Analysis": ["data analysis", "data analytics"],
  "Power BI": ["power bi", "powerbi"],
  Tableau: ["tableau"],
  Excel: ["ms excel", "microsoft excel", "advanced excel", "excel vba"],
  ETL: ["etl"],
  // Cloud & DevOps
  AWS: ["aws", "amazon web services"],
  Azure: ["azure", "microsoft azure"],
  GCP: ["gcp", "google cloud"],
  Docker: ["docker"],
  Kubernetes: ["kubernetes", "k8s"],
  Terraform: ["terraform"],
  Ansible: ["ansible"],
  "CI/CD": ["ci/cd", "cicd", "continuous integration"],
  Jenkins: ["jenkins"],
  "GitHub Actions": ["github actions"],
  Git: ["git"],
  Linux: ["linux", "ubuntu", "centos"],
  Nginx: ["nginx"],
  // Testing & practice
  Jest: ["jest"],
  Cypress: ["cypress"],
  Selenium: ["selenium"],
  "Unit Testing": ["unit testing", "unit tests"],
  "Test Automation": ["test automation", "automation testing"],
  Agile: ["agile"],
  Scrum: ["scrum"],
  Jira: ["jira"],
  "System Design": ["system design"],
  "Software Architecture": ["software architecture"],
  Security: ["cybersecurity", "cyber security", "information security", "owasp"],
  // Design
  Figma: ["figma"],
  "UI/UX Design": ["ui/ux", "ux design", "ui design", "user experience"],
  "Adobe Photoshop": ["photoshop"],
  "Adobe Illustrator": ["illustrator"],
  // Business & HR
  Recruitment: ["recruitment", "talent acquisition", "recruiting"],
  "HR Management": ["human resource", "human resources", "hrm", "hr management"],
  Payroll: ["payroll"],
  "Labour Law": ["labour law", "labor law", "bangladesh labour act"],
  Accounting: ["accounting", "bookkeeping"],
  "Financial Analysis": ["financial analysis", "financial modelling", "financial modeling"],
  Tally: ["tally"],
  SAP: ["sap"],
  ERP: ["erp"],
  "Supply Chain": ["supply chain", "procurement", "logistics"],
  Merchandising: ["merchandising", "merchandiser"],
  "Quality Control": ["quality control", "qc", "quality assurance"],
  "Lean Manufacturing": ["lean manufacturing", "six sigma", "kaizen"],
  AutoCAD: ["autocad"],
  "Project Management": ["project management", "pmp"],
  "Digital Marketing": ["digital marketing", "seo", "sem", "social media marketing"],
  Sales: ["sales", "business development"],
  "Customer Service": ["customer service", "customer support"],
  Communication: ["communication skills", "presentation skills"],
  Leadership: ["leadership", "team lead", "team leadership"],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Word-boundary regex that also works for tokens like "c++", ".net", "node.js". */
export function aliasRegex(alias: string): RegExp {
  return new RegExp(`(?<![\\w+#.])${escape(alias)}(?![\\w+#])`, "i");
}

const COMPILED: { canonical: string; patterns: RegExp[] }[] = Object.entries(SKILL_ALIASES).map(([canonical, aliases]) => ({
  canonical,
  // Aliases only: some canonical names ("Excel", "Spring") are ambiguous English words.
  patterns: aliases.map(aliasRegex),
}));

/** Canonical name for a skill string, or the trimmed input when unknown. */
export function canonicalSkill(skill: string): string {
  const s = skill.trim().toLowerCase();
  for (const { canonical } of COMPILED) {
    if (canonical.toLowerCase() === s || SKILL_ALIASES[canonical].includes(s)) return canonical;
  }
  return skill.trim();
}

/** All patterns that should count as a mention of `skill` (canonical + aliases + the literal). */
export function skillPatterns(skill: string): RegExp[] {
  const canonical = canonicalSkill(skill);
  const aliases = SKILL_ALIASES[canonical] ?? [];
  // The recruiter's own wording counts too, even when it is an ambiguous word.
  return [...new Set([skill.trim().toLowerCase(), ...aliases])].map(aliasRegex);
}

/** Find taxonomy skills mentioned in text, with the line that mentions each. */
export function findSkills(text: string): { name: string; evidence: string }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const found: { name: string; evidence: string }[] = [];
  for (const { canonical, patterns } of COMPILED) {
    const line = lines.find((l) => patterns.some((p) => p.test(l)));
    if (line) found.push({ name: canonical, evidence: line.slice(0, 240) });
  }
  return found;
}
