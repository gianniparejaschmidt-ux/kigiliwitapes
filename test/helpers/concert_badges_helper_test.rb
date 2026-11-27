require "minitest/autorun"
require_relative "../../app/helpers/concert_badges_helper"

class ConcertBadgesHelperTest < Minitest::Test
  include ConcertBadgesHelper

  {
    "Orchestra Show" => "Orchestra",
    "Experimental Rave Show" => "Rave",
    "Late Rave Show" => "Rave",
    "Acoustic Night" => "Acoustic",
    "Surprise Acoustic Show" => "Acoustic",
    "Marathon Night 1" => "Marathon",
    "Marathon Show Night 2" => "Marathon",
    "Microtonal Night" => "Microtonal",
    "Drag Night" => "Drag",
    "DJ Set" => "DJ Set",
    "Glastonbury Festival" => "Festival",
    "Field of Vision II" => "Festival",
    "Gizzfest Melbourne" => "Festival",
    "Primavera Sound" => "Festival",
    "  acoustic show  " => "Acoustic",
    "Lollapalooza Argentina Side Show" => nil,
    "Laneway After Party" => nil,
    "CMJ Music Marathon" => nil,
    "EP Launch" => nil,
    "Early Show" => nil,
    "Stu's Birthday" => nil,
    "" => nil,
    nil => nil
  }.each_with_index do |(title, expected), index|
    define_method("test_classification_#{index}") do
      if expected.nil?
        assert_nil concert_type_badge(title)
      else
        assert_equal expected, concert_type_badge(title)
      end
    end
  end
end
