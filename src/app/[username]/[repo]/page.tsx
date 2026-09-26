import type { Metadata } from "next";
import { permanentRedirect } from "next/navigation";
import { SITE_URL } from "~/lib/site";
import { getRepoPagePath } from "~/server/storage/repo-page-cache";
import { UmlWorkspace } from "~/components/uml-workspace";

type RepoPageProps = {
  params: Promise<{ username: string; repo: string }>;
};

// Successful generations invalidate the page and data tag on demand. Keep
// unchanged diagrams warm; this interval is only the fallback refresh.
export const revalidate = 21600;
export const dynamicParams = true;

export function generateStaticParams() {
  return [];
}

export async function generateMetadata({
  params,
}: RepoPageProps): Promise<Metadata> {
  const { username, repo } = await params;
  const repositoryPath = getRepoPagePath(username, repo);
  const image = {
    url: `${SITE_URL}${repositoryPath}/opengraph-image`,
    width: 1200,
    height: 630,
    alt: "GitUML repository preview",
  };
  const title = `${username}/${repo} UML Diagrams | GitUML`;
  const description = `Evidence-based UML and architecture diagrams for ${username}/${repo}.`;

  return {
    title,
    description,
    alternates: {
      canonical: repositoryPath,
    },
    openGraph: {
      title,
      description,
      url: `${SITE_URL}${repositoryPath}`,
      siteName: "GitUML",
      type: "website",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      creator: "@xoity",
      images: [image],
    },
  };
}

export default async function Repo({ params }: RepoPageProps) {
  const { username, repo } = await params;
  if (username !== username.toLowerCase() || repo !== repo.toLowerCase()) {
    permanentRedirect(getRepoPagePath(username, repo));
  }
  return (
    <UmlWorkspace
      key={`${username.toLowerCase()}/${repo.toLowerCase()}`}
      username={username}
      repo={repo}
    />
  );
}
