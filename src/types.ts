export type Kind = "pull_request" | "issue";
export type Status = "pass" | "warn" | "fail" | "skip";
export type Outcome = "trusted" | "pass" | "needs_info" | "low_effort";

export interface Author {
  login: string;
  isBot: boolean;
  association: string;
  createdAt: string | null;
  mergedPrs: number | null;
}

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  status: string;
  patch: string | null;
}

export interface LinkedIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
}

export interface CiState {
  state: "success" | "failure" | "pending" | "none";
  failing: string[];
}

export interface OtherItem {
  number: number;
  title: string;
  body: string;
}

export interface AuthorActivity {
  total: number;
  otherRepos: number;
  similarTitles: number;
  sameRepoSimilar: number;
}

interface SubjectBase {
  owner: string;
  repo: string;
  number: number;
  nodeId: string;
  title: string;
  body: string;
  author: Author;
  labels: string[];
  createdAt: string;
  others: OtherItem[] | null;
  templates: string[];
}

export interface PullSubject extends SubjectBase {
  kind: "pull_request";
  draft: boolean;
  headSha: string;
  baseSha: string;
  files: FileChange[];
  linkedIssues: LinkedIssue[];
  missingRefs: number[];
  ci: CiState | null;
  tree: Set<string> | null;
  activity: AuthorActivity | null;
}

export interface IssueSubject extends SubjectBase {
  kind: "issue";
}

export type Subject = PullSubject | IssueSubject;

export interface CheckResult {
  id: string;
  title: string;
  status: Status;
  weight: number;
  required: boolean;
  detail: string;
  todo?: string;
}

export interface LlmReview {
  provider: string;
  model: string;
  followsGuidelines: boolean;
  addressesIssue: boolean | null;
  concerns: string[];
  summary: string;
}

export interface Decision {
  kind: Kind;
  outcome: Outcome;
  score: number;
  trusted: boolean;
  trustReason: string | null;
  checks: CheckResult[];
  llm: LlmReview | null;
}
