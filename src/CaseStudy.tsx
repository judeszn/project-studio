import { SCREEN, TESTIMONY } from './site'
import { ScreenNote } from './ui'

// A historical incident, to show the problem AEMAS addresses; a page of its
// own, which the home page links to. Facts come from the public record and
// are cited; how AEMAS could apply is labelled hypothetical, and what it could
// not have done is stated as plainly. AEMAS was not used in this incident and
// holds none of its data.

// A footnote marker. Not a link: the address bar holds the page's route.
const SOURCE_1 = <sup className="ref">[1]</sup>

export function CaseStudy() {
  return (
    <section id="case-study" className="case-study" aria-labelledby="case-study-title">
      <div className="cs-head">
        <p className="eyebrow">Case study</p>
        <h1 id="case-study-title">Change Healthcare cyberattack, 2024</h1>
        <ScreenNote text={SCREEN.caseStudy} />
        <p className="lede">
          The attack began with a sign-in. Establishing how it happened depended on what the
          records could show.
        </p>
        <p className="cs-note">
          Historical facts below are from the public record, with the source cited. How AEMAS could
          apply is a hypothetical illustration: AEMAS was not used in this incident and holds no
          Change Healthcare data.
        </p>
      </div>

      <div className="cs-grid">
        <article className="cs-part">
          <p className="cs-tag fact">Public record</p>
          <h3>What happened</h3>
          <ul>
            <li>
              On 12 February 2024, attackers used compromised credentials to remotely access a
              Change Healthcare Citrix portal, an application for remote access to desktops. The
              portal did not have multi-factor authentication.{SOURCE_1}
            </li>
            <li>
              Once inside, they moved laterally and took data. On 21 February, nine days after
              first access, they deployed ransomware that encrypted Change Healthcare’s systems.{SOURCE_1}
            </li>
            <li>
              The company severed connectivity with Change’s data centres. Pharmacy services,
              medical claims and payments to providers across the US health system were
              disrupted.{SOURCE_1}
            </li>
          </ul>
        </article>

        <article className="cs-part">
          <p className="cs-tag analysis">The investigative challenge</p>
          <h3>Establishing how access occurred</h3>
          <ul>
            <li>
              When the ransomware was launched, the company did not yet know how the attackers had
              got in, according to its chief executive’s testimony.{SOURCE_1}
            </li>
            <li>
              The way in was a sign-in with valid credentials, which can look like ordinary remote
              access. Reconstructing it means working through authentication records: which
              accounts signed in, to which systems, and when.
            </li>
            <li>
              Investigators must keep what the records establish separate from what is assumed,
              because decisions about containment and disclosure rest on it.
            </li>
          </ul>
        </article>

        <article className="cs-part">
          <p className="cs-tag hypothetical">Hypothetical</p>
          <h3>Where AEMAS could have helped</h3>
          <ul>
            <li>
              Given the relevant authentication records, an analyst could use AEMAS to have AI
              propose findings about sign-in activity, each citing the specific records behind it.
            </li>
            <li>
              AEMAS checks every proposed finding against the records it cites before the analyst
              relies on it, and rejects findings the records do not support.
            </li>
            <li>
              Its report links each finding to the original records, so conclusions about how
              access occurred can be checked again by others.
            </li>
          </ul>
        </article>

        <article className="cs-part">
          <p className="cs-tag limit">Limits</p>
          <h3>What AEMAS could not have done</h3>
          <ul>
            <li>
              <strong>Prevented the intrusion.</strong> AEMAS does not enforce controls such as
              multi-factor authentication.
            </li>
            <li>
              <strong>Detected it as it happened.</strong> AEMAS analyses records supplied to it; it
              does not monitor systems or raise alerts.
            </li>
            <li>
              <strong>Established the full scope.</strong> Lateral movement, data theft and
              ransomware activity lie outside the authentication records AEMAS analyses today.
            </li>
            <li>
              <strong>Decided what happened.</strong> A verified finding shows that the cited
              records support it; the conclusion remains the analyst’s.
            </li>
          </ul>
        </article>
      </div>

      <div className="sources">
        <h3>Sources</h3>
        <ol>
          <li>
            {TESTIMONY.label}{' '}
            <a href={TESTIMONY.url} target="_blank" rel="noreferrer">
              docs.house.gov (PDF)
            </a>
            . The testimony notes that understanding of the incident might change as investigation
            continued.
          </li>
        </ol>
      </div>
    </section>
  )
}
