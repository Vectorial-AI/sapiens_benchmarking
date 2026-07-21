"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef } from "react";
import "./release-notes.css";

type Ship = {
  month: string;
  title: string;
  body: string;
  metric?: { lead: string; rest: string };
};

type Card = {
  kind: "core" | "sim" | "data";
  name: string;
  range: string;
  count: string;
  items: Ship[];
};

type Quarter = {
  label: string;
  meta: string;
  columns: string;
  cards: Card[];
};

const QUARTERS: Quarter[] = [
  {
    label: "Q3 2025",
    meta: "5 ships · 3 fronts",
    columns: "1fr 1.3fr 1.35fr",
    cards: [
      {
        kind: "core",
        name: "Behavior Model",
        range: "Aug 2025",
        count: "1 ship",
        items: [
          {
            month: "Aug",
            title: "SAPIENS 0.1 release",
            body: "First release of our proprietary human-behavior prediction model.",
          },
        ],
      },
      {
        kind: "sim",
        name: "Simulation",
        range: "Sep 2025",
        count: "2 ships",
        items: [
          {
            month: "Sep",
            title: "Focus group simulation",
            body: "Multi-persona qualitative sessions, moderated end-to-end by SAPIENS.",
          },
          {
            month: "Sep",
            title: "Survey simulation",
            body: "Synthetic survey fielding with response distributions in hours, not weeks.",
          },
        ],
      },
      {
        kind: "data",
        name: "Data Sources",
        range: "Jul – Aug 2025",
        count: "2 ships",
        items: [
          {
            month: "Jul",
            title: "Deep Research Agent for finding user panels",
            body: "Agentic research that assembles real user panels from across social media.",
          },
          {
            month: "Aug",
            title: "Panel data sources: LinkedIn + Reddit",
            body: "Professional and community discourse added as panel-sourcing platforms.",
          },
        ],
      },
    ],
  },
  {
    label: "Q4 2025",
    meta: "5 ships · 2 fronts",
    columns: "1fr 1.4fr",
    cards: [
      {
        kind: "sim",
        name: "Simulation",
        range: "Dec 2025",
        count: "2 ships",
        items: [
          {
            month: "Dec",
            title: "User journey simulation",
            body: "Step-by-step behavioral walkthroughs across the full customer journey.",
          },
          {
            month: "Dec",
            title: "Product simulation",
            body: "Predicted adoption and reaction testing for product concepts pre-launch.",
          },
        ],
      },
      {
        kind: "data",
        name: "Data Sources",
        range: "Oct – Nov 2025",
        count: "3 ships",
        items: [
          {
            month: "Oct",
            title: "Enterprise source integration",
            body: "Customers' first-party data connected directly into the simulation loop.",
          },
          {
            month: "Oct",
            title: "Data sources: Quora + YouTube",
            body: "Expanded the behavioral corpus with two high-signal public platforms.",
          },
          {
            month: "Nov",
            title: "Data source: Twitter / X",
            body: "Real-time social discourse added as a grounding source for personas.",
          },
        ],
      },
    ],
  },
  {
    label: "Q1 2026",
    meta: "4 ships · 2 fronts",
    columns: "1fr 1.9fr",
    cards: [
      {
        kind: "core",
        name: "Behavior Model",
        range: "Jan 2026",
        count: "1 ship",
        items: [
          {
            month: "Jan",
            title: "SAPIENS 1.0 release",
            body: "Full production model: higher behavioral fidelity, larger source graph.",
            metric: {
              lead: "25% better",
              rest: " than standard LLMs and other behavior foundation models",
            },
          },
        ],
      },
      {
        kind: "sim",
        name: "Simulation",
        range: "Feb – Mar 2026",
        count: "3 ships",
        items: [
          {
            month: "Feb",
            title: "Tribe generation — audience segmentation",
            body: "Populations self-organize into behavioral tribes, segmenting the audience automatically.",
          },
          {
            month: "Feb",
            title: "Creative testing simulation",
            body: "Ad and creative concept testing against simulated audience segments.",
          },
          {
            month: "Mar",
            title: "Chat simulation",
            body: "Simulated chat experiences — how users converse with a product, predicted.",
          },
        ],
      },
    ],
  },
  {
    label: "Q2 2026",
    meta: "7 ships · 2 fronts",
    columns: "2.4fr 1fr",
    cards: [
      {
        kind: "sim",
        name: "Simulation",
        range: "Apr – Jun 2026",
        count: "6 ships",
        items: [
          {
            month: "Apr",
            title: "PLG prototyping simulation",
            body: "Product-led prototype testing — simulate how users react before you build.",
          },
          {
            month: "Apr",
            title: "Landing page simulation",
            body: "Conversion and messaging response predicted per audience segment.",
          },
          {
            month: "May",
            title: "Figma simulation",
            body: "Simulation run directly on designs, where design already happens.",
          },
          {
            month: "May",
            title: "Lovable simulation",
            body: "Simulated user response on Lovable builds, before they reach real traffic.",
          },
          {
            month: "Jun",
            title: "A/B testing simulation",
            body: "Variant testing across segments — pick the winner before the traffic split.",
          },
          {
            month: "Jun",
            title: "Audience intelligence",
            body: "Always-on segment insights layered on top of the simulation engine.",
          },
        ],
      },
      {
        kind: "data",
        name: "Data Sources",
        range: "Jun 2026",
        count: "1 ship",
        items: [
          {
            month: "Jun",
            title: "Prolific integration",
            body: "Real-human panels wired in to ground, benchmark and calibrate SAPIENS.",
          },
        ],
      },
    ],
  },
  {
    label: "Q3 2026",
    meta: "5 ships — and counting",
    columns: "1.15fr 1.5fr",
    cards: [
      {
        kind: "core",
        name: "Behavior Model",
        range: "Jul 2026",
        count: "2 ships",
        items: [
          {
            month: "Jul",
            title: "SAPIENS 2.0 release",
            body: "Next-generation model, trained on the widened source graph.",
            metric: {
              lead: "33% better",
              rest: " than standard LLMs and other behavior foundation models",
            },
          },
          {
            month: "Jul",
            title: "SAPIENS Lite release",
            body: "Fast, lower-cost tier opening simulation to lighter-weight use cases.",
          },
        ],
      },
      {
        kind: "data",
        name: "Data Sources",
        range: "Jul 2026",
        count: "3 ships",
        items: [
          {
            month: "Jul",
            title: "AI-moderated interviews for enrichment",
            body: "AI-run interviews with real participants, feeding enriched signal back into the model.",
          },
          {
            month: "Jul",
            title: "Kentrix data partnership",
            body: "Consumer intelligence partnership deepening India-market coverage.",
          },
          {
            month: "Jul",
            title: "Data partnership program",
            body: "Formalized inbound data partnerships to compound the data moat.",
          },
        ],
      },
    ],
  },
];

export function ReleaseNotesView() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const cards = root.querySelectorAll(".rn-qcard");
    if (!("IntersectionObserver" in window)) {
      cards.forEach((c) => c.classList.add("visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 },
    );
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, []);

  return (
    <div ref={rootRef} className="release-notes-page">
      <header className="rn-header">
        <div className="rn-wrap rn-brand">
          <div className="rn-brand-left">
            <Link href="/" className="rn-back">
              ← Back
            </Link>
            <Image
              src="/vectorial-logo.png"
              alt="Vectorial"
              width={163}
              height={22}
              className="h-[22px] w-auto"
              priority
            />
          </div>
          <span className="rn-tagline">Engineering log · Jul 2025 → present</span>
        </div>
      </header>

      <div className="rn-wrap">
        <div className="rn-hero">
          <div className="rn-eyebrow">
            Vectorial AI<span className="rn-rule" />
            SAPIENS Platform
          </div>
          <h1>Release Notes</h1>
          <p className="rn-lede">
            Product updates from the Vectorial AI team. Every capability shipped on the SAPIENS
            platform since day one — across three fronts: the behavior model itself, the simulation
            suite on top of it, and the data sources underneath.
          </p>
          <div className="rn-legend">
            <span className="rn-lg">
              <i style={{ background: "var(--orange)" }} />
              Behavior Model
            </span>
            <span className="rn-lg">
              <i style={{ background: "var(--ink)" }} />
              Simulation
            </span>
            <span className="rn-lg">
              <i style={{ background: "var(--teal)" }} />
              Data Sources
            </span>
          </div>
        </div>

        <section className="rn-block">
          {QUARTERS.map((q) => (
            <div key={q.label}>
              <div className="rn-q-mark">
                <span className="rn-qlabel">{q.label}</span>
                <span className="rn-n">{q.meta}</span>
              </div>
              <div className="rn-qgrid" style={{ gridTemplateColumns: q.columns }}>
                {q.cards.map((card) => (
                  <div key={`${q.label}-${card.name}`} className={`rn-qcard ${card.kind}`}>
                    <div className="rn-qhead">
                      <span className="rn-cname">{card.name}</span>
                      <span className="rn-rng">{card.range}</span>
                      <span className="rn-cn">{card.count}</span>
                    </div>
                    <ul className="rn-items">
                      {card.items.map((item) => (
                        <li key={`${card.name}-${item.title}`}>
                          <span className="rn-m">{item.month}</span>
                          <div>
                            <h3>{item.title}</h3>
                            <p>{item.body}</p>
                            {item.metric ? (
                              <p className="rn-metric">
                                <b>{item.metric.lead}</b>
                                {item.metric.rest}
                              </p>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>

      <footer className="rn-footer">
        <div className="rn-wrap rn-row-f">
          <div>© Vectorial AI · SAPIENS platform</div>
        </div>
      </footer>
    </div>
  );
}
