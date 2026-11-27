module ConcertBadgesHelper
  def concert_type_badge(title)
    concert_title = title.to_s.strip

    case concert_title
    when /\borchestra\b/i then "Orchestra"
    when /\brave\b/i then "Rave"
    when /\bacoustic\b/i then "Acoustic"
    when /\bmicrotonal\b/i then "Microtonal"
    when /\bdrag\b/i then "Drag"
    when /\Amarathon\b|\Abush fire benefit marathon/i then "Marathon"
    when /\bdj set\b/i then "DJ Set"
    when /side show|after.?party|showcase/i then nil
    when /festival|gizzfest|field of vision|coachella|lollapalooza|primavera sound|levitation|lowlands|big day out|bbk live|austin psych fest|all together now|iceland airwaves|le guess who|rock en seine|splendour in the grass|super bock super rock|wave\s?rock weekender|summadayze|pako festa|cherryfest|grietfest|field day|vodaphone mexefest/i
    "Festival"
    end
  end
end
