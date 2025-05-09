export type SiteConfig = {
    title: string;
    subtitle?: string;
    description: string;
    pageType: string;
    image?: {src: string; alt: string};
    postsPerPage?: number;
    projectsPerPage?: number;
};

const siteConfig: SiteConfig = {
    title: 'stefkn.com',
    subtitle: 'software, hardware, wetware',
    description: 'stefan nowak, software engineer based in London, UK',
    pageType: 'website',
    image: {
        src: '/favicon.png',
        alt: 'stefkn.com logo'
    },
};

export default siteConfig;
